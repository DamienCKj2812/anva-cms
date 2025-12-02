import { ObjectId, Db, Collection, FindOptions } from "mongodb";
import { validateObjectId } from "../../../utils/helper.mongo";
import { BadRequestError, NotFoundError, ValidationError } from "../../../utils/helper.errors";
import { filterFields, WithMetaData } from "../../../utils/helper";
import { QueryOptions, findWithOptions } from "../../../utils/helper";
import { AppContext } from "../../../utils/helper.context";
import { BaseService } from "../../core/base-service";
import { Content, ContentCount, ContentStatusEnum, CreateContentData, UpdateContentData } from "./models";
import ContentCollectionService from "../../content-collection/database/services";
import { ContentCollection } from "../../content-collection/database/models";
import { getCurrentUserId } from "../../../utils/helper.auth";
import ContentTranslationService from "../../content-translation/database/services";

class ContentService extends BaseService {
  private db: Db;
  private collection: Collection<Content>;
  public readonly collectionName = "contents";
  private static readonly ALLOWED_UPDATE_FIELDS: ReadonlySet<keyof UpdateContentData> = new Set(["status"] as const);
  private contentCollectionService: ContentCollectionService;
  private contentTranslationService: ContentTranslationService;

  constructor(context: AppContext) {
    super(context);
    this.db = context.mongoDatabase;
    this.collection = this.db.collection<Content>(this.collectionName);
  }

  async init() {
    this.contentCollectionService = this.getService("ContentCollectionService");
    this.contentTranslationService = this.getService("ContentTranslationService");
  }

  private async createValidation(createData: CreateContentData): Promise<{ validatedData: CreateContentData; contentCollection: ContentCollection }> {
    const { contentCollectionId, status } = createData;
    if (!("contentCollectionId" in createData)) {
      throw new ValidationError('"contentCollectionId" field is required');
    }
    if (!("status" in createData)) {
      throw new ValidationError('"status" field is required');
    }
    if (!("contentTranslationDto" in createData)) {
      throw new ValidationError('"contentTranslation" field is required');
    }
    const contentCollection = await this.contentCollectionService.getById(contentCollectionId);
    if (!contentCollection) {
      throw new NotFoundError("Content collection not found");
    }
    if (!Object.values(ContentStatusEnum).includes(status as ContentStatusEnum)) {
      throw new ValidationError(`Status type must be one of: ${Object.values(ContentStatusEnum).join(", ")}`);
    }
    return {
      validatedData: createData,
      contentCollection,
    };
  }

  async create(data: CreateContentData): Promise<Content> {
    const { contentCollection, validatedData } = await this.createValidation(data);
    const userId = getCurrentUserId(this.context);
    console.log({ createData: data });
    const newContent: Content = {
      _id: new ObjectId(),
      contentCollectionId: contentCollection._id!,
      status: validatedData.status as ContentStatusEnum,
      createdAt: new Date(),
      updatedAt: null,
      createdBy: userId,
    };
    await this.collection.insertOne(newContent);
    try {
      await this.contentTranslationService.create(data.contentTranslationDto, contentCollection, newContent);
    } catch (err) {
      await this.collection.deleteOne({ _id: newContent._id });
      throw err;
    }
    return newContent;
  }

  async getAll(queryOptions: QueryOptions): Promise<WithMetaData<Content>> {
    const options = {
      ...queryOptions,
      filter: {
        ...(queryOptions.filter || {}),
      },
    };
    return await findWithOptions(this.collection, options);
  }

  async getById(id: string): Promise<Content | null> {
    validateObjectId(id);
    return await this.collection.findOne({ _id: new ObjectId(id) });
  }

  async getContentCount(createdBy: ObjectId): Promise<ContentCount[]> {
    const counts = await this.collection
      .aggregate([{ $match: { createdBy } }, { $group: { _id: "$contentCollectionId", count: { $sum: 1 } } }])
      .toArray();

    return counts as ContentCount[];
  }

  async findOne(filter: Partial<Content>, options?: FindOptions<Content>): Promise<Content | null> {
    return await this.collection.findOne(filter, options);
  }

  private async updateValidation(
    contentId: string,
    updateData: UpdateContentData,
  ): Promise<{ content: Content; contentCollection: ContentCollection; validatedData: UpdateContentData }> {
    const { status } = updateData;

    if (!contentId) {
      throw new BadRequestError("Missing content Id");
    }
    const content = await this.getById(contentId);
    if (!content) {
      throw new NotFoundError("Content not found");
    }
    const contentCollection = await this.contentCollectionService.getById(content?.contentCollectionId.toString());
    if (!contentCollection) {
      throw new NotFoundError("Content collection not found");
    }
    if (status !== undefined && !Object.values(ContentStatusEnum).includes(status as ContentStatusEnum)) {
      throw new ValidationError(`Status type must be one of: ${Object.values(ContentStatusEnum).join(", ")}`);
    }

    return { content, contentCollection, validatedData: updateData };
  }

  async update(id: string, data: UpdateContentData): Promise<Content> {
    validateObjectId(id);
    const filteredUpdateData = filterFields(data, ContentService.ALLOWED_UPDATE_FIELDS);
    const { content, contentCollection, validatedData } = await this.updateValidation(id, filteredUpdateData);
    const updatingFields: Partial<Content> = {
      ...validatedData,
      status: validatedData.status as ContentStatusEnum,
    };
    const updatedContent = await this.collection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: updatingFields, $currentDate: { updatedAt: true } },
      { returnDocument: "after" },
    );
    if (!updatedContent) {
      throw new NotFoundError("failed to update content");
    }

    return updatedContent;
  }

  private async deleteValidation(id: string): Promise<Content> {
    const content = await this.collection.findOne({ _id: new ObjectId(id) }, { projection: { name: 1 } });
    if (!content) {
      throw new NotFoundError("content not found");
    }
    return content;
  }

  async delete(id: string): Promise<Content> {
    const content = await this.deleteValidation(id);
    await this.collection.deleteOne({ _id: content._id });
    return content;
  }
}

export default ContentService;
