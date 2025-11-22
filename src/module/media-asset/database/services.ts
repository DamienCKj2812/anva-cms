import { ObjectId, Db, Collection, FindOptions, Filter, ClientSession } from "mongodb";
import { validateObjectId } from "../../../utils/helper.mongo";
import { BadRequestError, NotFoundError } from "../../../utils/helper.errors";
import { WithMetaData } from "../../../utils/helper";
import { QueryOptions, findWithOptions } from "../../../utils/helper";
import { AppContext } from "../../../utils/helper.context";
import { BaseService } from "../../core/base-service";
import { CreateFileData, MediaAsset, MediaTypeEnum } from "./models";
import TenantService from "../../tenant/database/services";
import { Tenant } from "../../tenant/database/models";
import { getCurrentUserId } from "../../../utils/helper.auth";
import FileUploaderGCSService from "../../../utils/helper.fileUploadGCSService";
import path from "path";

class MediaAssetService extends BaseService {
  private db: Db;
  private collection: Collection<MediaAsset>;
  public readonly collectionName = "media-asset";
  private tenantService: TenantService;
  private fileUploaderGCSService: FileUploaderGCSService;

  constructor(context: AppContext) {
    super(context);
    this.db = context.mongoDatabase;
    this.collection = this.db.collection<MediaAsset>(this.collectionName);
  }

  async init() {
    this.tenantService = this.getService("TenantService");
    this.fileUploaderGCSService = this.getService("FileUploaderGCSService");
    await this.collection.createIndex({ tenantId: 1, parentId: 1, name: 1 });
  }

  async createImages(data: CreateFileData, files: Express.Multer.File[]): Promise<MediaAsset[]> {
    if (!files || files.length === 0) throw new BadRequestError("No files provided");
    const uploads = await Promise.all(files.map((f) => this.fileUploaderGCSService.uploadImageToGCS(f)));
    const assets = await this.createImageBulk(data, files);
    // Update URLs after bulk insert
    await this.collection.bulkWrite(
      assets.map((asset, i) => ({
        updateOne: {
          filter: { _id: asset._id },
          update: { $set: { height: uploads[i].height, width: uploads[i].width, url: uploads[i].url, storageKey: uploads[i].storageKey } },
        },
      }))
    );
    assets.forEach((a, i) => {
      a.url = uploads[i].url;
      a.storageKey = uploads[i].storageKey;
    });
    return assets;
  }

  private async createFileValidation(data: CreateFileData): Promise<{ validatedData: CreateFileData; tenant: Tenant; parent: MediaAsset | null }> {
    const { tenantId, parentId } = data;
    if (!tenantId) {
      throw new BadRequestError('"tenantId" field is required');
    }
    const tenant = await this.tenantService.getById(tenantId);
    if (!tenant) {
      throw new NotFoundError("tenant not found");
    }
    let parent: null | MediaAsset = null;
    if (parentId) {
      parent = await this.findOne({ _id: new ObjectId(parentId) });
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

  private async createImageBulk(data: CreateFileData, files: Express.Multer.File[], session?: ClientSession): Promise<MediaAsset[]> {
    const userId = getCurrentUserId(this.context);
    const { validatedData, tenant, parent } = await this.createFileValidation(data);

    const names = await this.getUniqueMediaAssetNamesBatch(
      tenant._id!,
      parent?._id ?? null,
      files.map((f) => f.originalname)
    );

    const assets: MediaAsset[] = [];
    const operations: any[] = [];

    files.forEach((file, i) => {
      if (!file.mimetype.startsWith("image/")) {
        throw new BadRequestError(`Invalid file type: ${file.originalname} is not an image`);
      }

      const storageKey = this.fileUploaderGCSService.getStorageKey(file);
      const asset: MediaAsset = {
        tenantId: tenant._id!,
        mediaType: MediaTypeEnum.FILE,
        originalFileName: file.originalname,
        name: names[i],
        parentId: parent?._id ?? null,
        storageKey,
        size: file.size,
        mimeType: file.mimetype,
        url: "", // placeholder
        width: null, // placeholder
        height: null, // placeholder
        duration: null,
        thumbnailUrl: null,
        metadata: null,
        createdBy: userId,
        createdAt: new Date(),
        updatedAt: null,
      };
      assets.push(asset);
      operations.push({ insertOne: { document: asset } });
    });

    const result = await this.collection.bulkWrite(operations, { session });
    Object.values(result.insertedIds).forEach((id, idx) => (assets[idx]._id = id as ObjectId));
    return assets;
  }

  async createVideos(data: CreateFileData, files: Express.Multer.File[]): Promise<MediaAsset[]> {
    if (!files || files.length === 0) throw new BadRequestError("No files provided");

    const uploads = await Promise.all(files.map((f) => this.fileUploaderGCSService.uploadVideoToGCS(f)));
    const assets = await this.createVideoBulk(data, files);
    // Update URLs after bulk insert
    await this.collection.bulkWrite(
      assets.map((asset, i) => ({
        updateOne: {
          filter: { _id: asset._id },
          update: { $set: { url: uploads[i].url, storageKey: uploads[i].storageKey } },
        },
      }))
    );
    assets.forEach((a, i) => {
      a.url = uploads[i].url;
      a.storageKey = uploads[i].storageKey;
    });
    return assets;
  }

  private async createVideoBulk(data: CreateFileData, files: Express.Multer.File[], session?: ClientSession): Promise<MediaAsset[]> {
    const userId = getCurrentUserId(this.context);
    const { validatedData, tenant, parent } = await this.createFileValidation(data);

    const names = await this.getUniqueMediaAssetNamesBatch(
      tenant._id!,
      parent?._id ?? null,
      files.map((f) => f.originalname)
    );

    const assets: MediaAsset[] = [];
    const operations: any[] = [];

    files.forEach((file, i) => {
      if (!file.mimetype.startsWith("video/")) {
        throw new BadRequestError(`Invalid file type: ${file.originalname} is not an video`);
      }

      const storageKey = this.fileUploaderGCSService.getStorageKey(file);
      const asset: MediaAsset = {
        tenantId: tenant._id!,
        mediaType: MediaTypeEnum.FILE,
        originalFileName: file.originalname,
        name: names[i],
        parentId: parent?._id ?? null,
        storageKey,
        size: file.size,
        mimeType: file.mimetype,
        url: "", // placeholder
        width: null,
        height: null,
        duration: null,
        thumbnailUrl: null,
        metadata: null,
        createdBy: userId,
        createdAt: new Date(),
        updatedAt: null,
      };
      assets.push(asset);
      operations.push({ insertOne: { document: asset } });
    });

    const result = await this.collection.bulkWrite(operations, { session });
    Object.values(result.insertedIds).forEach((id, idx) => (assets[idx]._id = id as ObjectId));
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
        { projection: { name: 1 } }
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
