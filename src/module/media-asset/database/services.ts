import { ObjectId, Db, Collection, FindOptions, Filter, ClientSession } from "mongodb";
import { validateObjectId } from "../../../utils/helper.mongo";
import { BadRequestError, NotFoundError } from "../../../utils/helper.errors";
import { WithMetaData } from "../../../utils/helper";
import { QueryOptions, findWithOptions } from "../../../utils/helper";
import { AppContext } from "../../../utils/helper.context";
import { BaseService } from "../../core/base-service";
import { CreateFileData, MediaAsset } from "./models";
import TenantService from "../../tenant/database/services";
import { Tenant } from "../../tenant/database/models";
import { getCurrentUserId } from "../../../utils/helper.auth";
import FileUploaderGCSService from "../../../utils/helper.fileUploadGCSService";
import path from "path";
import FolderService from "../../folder/database/services";
import { Folder } from "../../folder/database/models";

class MediaAssetService extends BaseService {
  private db: Db;
  private collection: Collection<MediaAsset>;
  public readonly collectionName = "media-asset";
  private tenantService: TenantService;
  private folderService: FolderService;

  constructor(context: AppContext) {
    super(context);
    this.db = context.mongoDatabase;
    this.collection = this.db.collection<MediaAsset>(this.collectionName);
  }

  async init() {
    this.tenantService = this.getService("TenantService");
    this.folderService = this.getService("FolderService");
    await this.collection.createIndex({ tenantId: 1, parentId: 1, name: 1 });
  }

  getCollection(): Collection<MediaAsset> {
    return this.collection;
  }

  private async createFileValidation(data: CreateFileData): Promise<{ validatedData: CreateFileData; tenant: Tenant; parent: Folder | null }> {
    const { tenantId, parentId } = data;
    if (!tenantId) {
      throw new BadRequestError('"tenantId" field is required');
    }
    const tenant = await this.tenantService.getById(tenantId);
    if (!tenant) {
      throw new NotFoundError("tenant not found");
    }
    let parent: null | Folder = null;
    if (parentId) {
      parent = await this.folderService.findOne({ _id: new ObjectId(parentId) });
      if (!parent) {
        throw new NotFoundError("parent not found");
      }
    }
    return {
      tenant,
      validatedData: data,
      parent,
    };
  }

  async createImages(data: CreateFileData, files: Express.Multer.File[], fileUploaderGCSService: FileUploaderGCSService): Promise<MediaAsset[]> {
    if (!files || files.length === 0) {
      throw new BadRequestError("No files provided");
    }

    const { validatedData, tenant, parent } = await this.createFileValidation(data);
    const userId = getCurrentUserId(this.context);

    const names = await this.getUniqueMediaAssetNamesBatch(
      tenant._id!,
      parent?._id ?? null,
      files.map((f) => f.originalname),
    );

    const uploads = await Promise.all(files.map((file, i) => fileUploaderGCSService.uploadImageToGCS(file, names[i])));

    const assets: MediaAsset[] = files.map((file, i) => {
      if (!file.mimetype.startsWith("image/")) {
        throw new BadRequestError(`Invalid file type: ${file.originalname} is not an image`);
      }

      return {
        _id: new ObjectId(),
        tenantId: tenant._id,
        originalFileName: uploads[i].name,
        name: uploads[i].name,
        parentId: parent?._id ?? null,
        storageKey: uploads[i].storageKey,
        size: uploads[i].size,
        mimeType: uploads[i].mimetype,
        url: uploads[i].url,
        width: uploads[i].width,
        height: uploads[i].height,
        duration: null,
        thumbnailUrl: null,
        metadata: null,
        createdBy: userId,
        createdAt: new Date(),
        updatedAt: null,
      };
    });

    await this.collection.insertMany(assets);

    return assets;
  }

  async createVideos(data: CreateFileData, files: Express.Multer.File[], fileUploaderGCSService: FileUploaderGCSService): Promise<MediaAsset[]> {
    if (!files || files.length === 0) {
      throw new BadRequestError("No files provided");
    }

    const { validatedData, tenant, parent } = await this.createFileValidation(data);
    const userId = getCurrentUserId(this.context);

    const names = await this.getUniqueMediaAssetNamesBatch(
      tenant._id!,
      parent?._id ?? null,
      files.map((f) => f.originalname),
    );

    const uploads = await Promise.all(files.map((file, i) => fileUploaderGCSService.uploadVideoToGCS(file, names[i])));

    const assets: MediaAsset[] = files.map((file, i) => {
      if (!file.mimetype.startsWith("video/")) {
        throw new BadRequestError(`Invalid file type: ${file.originalname} is not a video`);
      }

      return {
        _id: new ObjectId(),
        tenantId: tenant._id!,
        originalFileName: uploads[i].name,
        name: uploads[i].name,
        parentId: parent?._id ?? null,
        storageKey: uploads[i].storageKey,
        size: uploads[i].size,
        mimeType: uploads[i].mimetype,
        url: uploads[i].url,
        width: uploads[i].width ?? null,
        height: uploads[i].height ?? null,
        duration: uploads[i].duration ?? null,
        thumbnailUrl: uploads[i].thumbnailUrl ?? null,
        metadata: null,
        createdBy: userId,
        createdAt: new Date(),
        updatedAt: null,
      };
    });

    // 5️⃣ Insert all assets in one go
    await this.collection.insertMany(assets);

    return assets;
  }

  async getAll(queryOptions: QueryOptions): Promise<WithMetaData<MediaAsset>> {
    const options = {
      ...queryOptions,
      filter: {
        ...(queryOptions.filter || {}),
      },
    };
    return await findWithOptions(this.collection, options);
  }

  async getById(id: string): Promise<MediaAsset | null> {
    validateObjectId(id);
    return await this.collection.findOne({ _id: new ObjectId(id) });
  }

  async findOne(filter: Partial<MediaAsset>, options?: FindOptions<MediaAsset>): Promise<MediaAsset | null> {
    return await this.collection.findOne(filter, options);
  }

  async findMany(filter: Filter<MediaAsset>, options?: FindOptions<MediaAsset>): Promise<MediaAsset[]> {
    return this.collection.find(filter, options).toArray();
  }

  private async getUniqueMediaAssetNamesBatch(tenantId: ObjectId, parentId: ObjectId | null, originalNames: string[]): Promise<string[]> {
    // Step 1: Get all existing files in DB that might conflict
    const regexes = originalNames.map((name) => {
      const ext = path.extname(name);
      const base = path.basename(name, ext);
      return new RegExp(`^${base}(\\(\\d+\\))?${ext}$`);
    });

    const existingFiles = await this.collection
      .find(
        {
          tenantId,
          parentId,
          $or: regexes.map((r) => ({ name: { $regex: r } })),
        },
        { projection: { name: 1 } },
      )
      .toArray();

    // Step 2: Track used numbers per base name
    const usedNumbersMap = new Map<string, Set<number>>();
    for (const file of existingFiles) {
      const ext = path.extname(file.name);
      const base = path.basename(file.name, ext).replace(/\(\d+\)$/, "");
      const match = file.name.match(/\((\d+)\)\.[^.]+$/);
      const set = usedNumbersMap.get(base) || new Set<number>();
      set.add(match ? parseInt(match[1], 10) : 0);
      usedNumbersMap.set(base, set);
    }

    // Step 3: Assign unique names for this batch
    const resultNames: string[] = [];
    const batchUsedNumbers = new Map<string, Set<number>>(); // track names in this batch

    for (const originalName of originalNames) {
      const ext = path.extname(originalName);
      const base = path.basename(originalName, ext);

      const usedNumbers = new Set<number>(usedNumbersMap.get(base) || []);
      const batchSet = batchUsedNumbers.get(base) || new Set<number>();
      let counter = 0;
      while (usedNumbers.has(counter) || batchSet.has(counter)) {
        counter++;
      }
      batchSet.add(counter);
      batchUsedNumbers.set(base, batchSet);

      resultNames.push(counter === 0 ? `${base}${ext}` : `${base}(${counter})${ext}`);
    }

    return resultNames;
  }
}

export default MediaAssetService;
