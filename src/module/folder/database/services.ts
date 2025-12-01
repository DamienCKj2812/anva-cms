import { ObjectId, Db, Collection, FindOptions, Filter } from "mongodb";
import { validateObjectId } from "../../../utils/helper.mongo";
import { BadRequestError, NotFoundError } from "../../../utils/helper.errors";
import { WithMetaData } from "../../../utils/helper";
import { QueryOptions, findWithOptions } from "../../../utils/helper";
import { AppContext } from "../../../utils/helper.context";
import { BaseService } from "../../core/base-service";
import { CreateFolderData, Folder, } from "./models";
import TenantService from "../../tenant/database/services";
import { Tenant } from "../../tenant/database/models";
import { getCurrentUserId } from "../../../utils/helper.auth";

class FolderService extends BaseService {
  private db: Db;
  private collection: Collection<Folder>;
  public readonly collectionName = "folders";
  private tenantService: TenantService;

  constructor(context: AppContext) {
    super(context);
    this.db = context.mongoDatabase;
    this.collection = this.db.collection<Folder>(this.collectionName);
  }

  async init() {
    this.tenantService = this.getService("TenantService");
    await this.collection.createIndex({ tenantId: 1, parentId: 1, name: 1 });
  }


  private async createValidation(data: CreateFolderData): Promise<{ validatedData: CreateFolderData; tenant: Tenant; parent: Folder | null }> {
    const { tenantId, parentId, name } = data;
    if (!tenantId) {
      throw new BadRequestError('"tenantId" field is required');
    }
    const tenant = await this.tenantService.getById(tenantId);
    if (!tenant) {
      throw new NotFoundError("tenant not found");
    }
    let parent: null | Folder = null;
    if (parentId) {
      parent = await this.findOne({ _id: new ObjectId(parentId) });
      if (!parent) {
        throw new NotFoundError("parent not found");
      }
    }
    if (!name) {
      throw new NotFoundError("name not found");
    }
    return {
      tenant,
      validatedData: data,
      parent,
    };
  }


  async create(data: CreateFolderData): Promise<Folder> {
    const { validatedData, tenant, parent } = await this.createValidation(data);
    const userId = getCurrentUserId(this.context);

    const [uniqueName] = await this.getUniqueFolderNamesBatch(
      tenant._id,
      parent?._id ?? null,
      [validatedData.name]
    );

    const folder: Folder = {
      _id: new ObjectId(),
      tenantId: tenant._id,
      name: uniqueName,
      parentId: parent?._id ?? null,
      metadata: {},
      createdBy: userId,
      createdAt: new Date(),
      updatedAt: null,
    };

    await this.collection.insertOne(folder);

    return folder;
  }

  async getAll(queryOptions: QueryOptions): Promise<WithMetaData<Folder>> {
    const options = {
      ...queryOptions,
      filter: {
        ...(queryOptions.filter || {}),
      },
    };
    return await findWithOptions(this.collection, options);
  }

  async getById(id: string): Promise<Folder | null> {
    validateObjectId(id);
    return await this.collection.findOne({ _id: new ObjectId(id) });
  }

  async getFolderPath(folderId: string): Promise<Folder[]> {
    const _id = new ObjectId(folderId);

    const result = await this.collection.aggregate([
      {
        $match: { _id }
      },
      {
        $graphLookup: {
          from: "folders",
          startWith: "$parentId",
          connectFromField: "parentId",
          connectToField: "_id",
          as: "ancestors",
          depthField: "level"
        }
      },
      {
        $project: {
          _id: 1,
          tenantId: 1,
          parentId: 1,
          name: 1,
          metadata: 1,
          createdBy: 1,
          createdAt: 1,
          updatedAt: 1,
          ancestors: 1
        }
      }
    ]).toArray();

    if (!result[0]) throw new Error("Folder not found");

    const doc = result[0];
    const sortedAncestors = doc.ancestors.sort((a, b) => a.level - b.level);
    const orderedPath = [...sortedAncestors, doc];
    return orderedPath;
  }

  async findOne(filter: Partial<Folder>, options?: FindOptions<Folder>): Promise<Folder | null> {
    return await this.collection.findOne(filter, options);
  }

  async findMany(filter: Filter<Folder>, options?: FindOptions<Folder>): Promise<Folder[]> {
    return this.collection.find(filter, options).toArray();
  }

  private async getUniqueFolderNamesBatch(
    tenantId: ObjectId,
    parentId: ObjectId | null,
    originalNames: string[]
  ): Promise<string[]> {

    // Step 1: Build regex for each name (folder has no extension)
    const regexes = originalNames.map((name) => {
      return new RegExp(`^${name}(\\(\\d+\\))?$`);
    });

    // Step 2: Fetch existing conflicting folders
    const existingFolders = await this.collection.find(
      {
        tenantId,
        parentId,
        $or: regexes.map((r) => ({ name: { $regex: r } })),
      },
      { projection: { name: 1 } }
    ).toArray();

    // Step 3: Track used numbers
    const usedMap = new Map<string, Set<number>>();

    for (const folder of existingFolders) {
      const name = folder.name;
      const match = name.match(/^(.*?)(?:\((\d+)\))?$/);

      if (!match) continue;

      const base = match[1];
      const num = match[2] ? parseInt(match[2], 10) : 0;

      if (!usedMap.has(base)) usedMap.set(base, new Set());
      usedMap.get(base)!.add(num);
    }

    // Step 4: Generate unique names
    const batchMap = new Map<string, Set<number>>();
    const result: string[] = [];

    for (const name of originalNames) {
      const used = new Set(usedMap.get(name) || []);
      const batch = batchMap.get(name) || new Set();

      let counter = 0;
      while (used.has(counter) || batch.has(counter)) {
        counter++;
      }

      batch.add(counter);
      batchMap.set(name, batch);

      result.push(counter === 0 ? name : `${name}(${counter})`);
    }

    return result;
  }

}

export default FolderService;
