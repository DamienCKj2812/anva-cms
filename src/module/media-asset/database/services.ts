import { ObjectId, Db, Collection, FindOptions, Filter, ClientSession } from "mongodb";
import { validateObjectId } from "../../../utils/helper.mongo";
import { BadRequestError, NotFoundError, ValidationError } from "../../../utils/helper.errors";
import { filterFields, WithMetaData } from "../../../utils/helper";
import { QueryOptions, findWithOptions } from "../../../utils/helper";
import { AppContext } from "../../../utils/helper.context";
import { BaseService } from "../../core/base-service";
import { MediaAsset, UpdateMediaAssetData } from "./models";
import TenantService from "../../tenant/database/services";
import { Tenant } from "../../tenant/database/models";
import { getCurrentUserId } from "../../../utils/helper.auth";
import path from "path";
import FolderService from "../../folder/database/services";
import { Folder } from "../../folder/database/models";
import sharp from "sharp";

class MediaAssetService extends BaseService {
  private db: Db;
  private collection: Collection<MediaAsset>;
  private static readonly ALLOWED_UPDATE_FIELDS: ReadonlySet<keyof UpdateMediaAssetData> = new Set(["folderId", "name"] as const);
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
    await this.collection.createIndex({ tenantId: 1, folderId: 1, name: 1 });
  }

  getCollection(): Collection<MediaAsset> {
    return this.collection;
  }

  async createImages(files: Express.Multer.File[], tenant: Tenant, folder?: Folder): Promise<MediaAsset[]> {
    const userId = getCurrentUserId(this.context);

    const assets: MediaAsset[] = await Promise.all(
      files.map(async (file) => {
        let width: number | null = null;
        let height: number | null = null;

        const metadata = await sharp(file.path).metadata();
        width = metadata.width ?? null;
        height = metadata.height ?? null;

        const ext = path.extname(file.filename);
        const mediaId = path.basename(file.filename, ext);

        const originalBaseName = path.basename(file.originalname ?? "Unnamed", path.extname(file.originalname ?? ""));
        const fileName = `${originalBaseName}.webp`;

        return {
          _id: new ObjectId(),
          mediaId,
          tenantId: tenant._id,
          folderId: folder?._id ?? null,
          originalFileName: fileName,
          filePath: file.path,
          name: fileName,
          size: file.size,
          mimeType: "image/webp",
          width,
          height,
          duration: null,
          thumbnailUrl: null,
          metadata: {},
          createdBy: userId,
          createdAt: new Date(),
          updatedAt: null,
        };
      }),
    );

    const result = await this.collection.insertMany(assets);

    return assets.map((asset, i) => ({
      ...asset,
      _id: result.insertedIds[i],
    }));
  }

  async createApplications(files: Express.Multer.File[], tenant: Tenant, folder?: Folder): Promise<MediaAsset[]> {
    const userId = getCurrentUserId(this.context);

    const assets: MediaAsset[] = files.map((file) => {
      const ext = path.extname(file.filename);
      const mediaId = path.basename(file.filename, ext);

      return {
        _id: new ObjectId(),
        mediaId,
        tenantId: tenant._id,
        folderId: folder?._id ?? null,
        originalFileName: file.originalname ?? null,
        filePath: file.path,
        name: file.originalname,
        size: file.size,
        mimeType: file.mimetype,
        width: null,
        height: null,
        duration: null,
        thumbnailUrl: null,
        metadata: {},
        createdBy: userId,
        createdAt: new Date(),
        updatedAt: null,
      };
    });

    const result = await this.collection.insertMany(assets);

    return assets.map((asset, i) => ({
      ...asset,
      _id: result.insertedIds[i],
    }));
  }

  async createVideos(files: Express.Multer.File[], tenant: Tenant, folder?: Folder): Promise<MediaAsset[]> {
    const userId = getCurrentUserId(this.context);

    const assets: MediaAsset[] = files.map((file) => {
      const ext = path.extname(file.originalname);
      const mediaId = path.basename(file.filename, ext);

      return {
        _id: new ObjectId(),
        mediaId,
        tenantId: tenant._id,
        folderId: folder?._id ?? null,
        originalFileName: file.originalname ?? null,
        filePath: file.path,
        name: file.originalname ?? "Unnamed",
        size: file.size,
        mimeType: file.mimetype,
        width: null,
        height: null,
        duration: null,
        thumbnailUrl: null,
        metadata: {},
        createdBy: userId,
        createdAt: new Date(),
        updatedAt: null,
      };
    });

    const result = await this.collection.insertMany(assets);

    return assets.map((asset, i) => ({
      ...asset,
      _id: result.insertedIds[i],
    }));
  }

  private async updateValidation(updateData: UpdateMediaAssetData): Promise<{ validatedData: UpdateMediaAssetData; folder: Folder | null }> {
    const { name, folderId } = updateData;

    if (!("name" in updateData) && !("folderId" in updateData)) {
      throw new BadRequestError("No valid fields provided for update");
    }

    if (name !== undefined && (typeof name !== "string" || !name.trim())) {
      throw new ValidationError("name must be a non-empty string");
    }

    let folder: null | Folder = null;
    if (folderId !== undefined) {
      folder = await this.folderService.findOne({ _id: new ObjectId(folderId) });
      if (!folder) {
        throw new NotFoundError("folder not found");
      }
    }
    return {
      validatedData: updateData,
      folder,
    };
  }

  async update(data: UpdateMediaAssetData, mediaAsset: MediaAsset): Promise<MediaAsset> {
    const filteredUpdateData = filterFields(data, MediaAssetService.ALLOWED_UPDATE_FIELDS);

    const { validatedData } = await this.updateValidation(filteredUpdateData);

    const updatingFields: Partial<MediaAsset> = {
      ...validatedData,
      folderId: validatedData.folderId ? new ObjectId(validatedData.folderId) : undefined,
    };

    const updatedMediaAsset = await this.collection.findOneAndUpdate(
      { _id: mediaAsset._id },
      { $set: updatingFields, $currentDate: { updatedAt: true } },
      { returnDocument: "after" },
    );

    if (!updatedMediaAsset) throw new NotFoundError("Failed to update media asset");

    return updatedMediaAsset;
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

  async delete(mediaAsset: MediaAsset): Promise<MediaAsset> {
    const deletedMediaAsset = await this.collection.findOneAndDelete({ _id: mediaAsset._id });
    if (!deletedMediaAsset) throw new NotFoundError("Failed to delete media asset");

    return deletedMediaAsset;
  }
}

export default MediaAssetService;
