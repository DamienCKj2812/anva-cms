import { ObjectId, Db, Collection, FindOptions } from "mongodb";
import { validateObjectId } from "../../../utils/helper.mongo";
import { BadRequestError, NotFoundError, ValidationError } from "../../../utils/helper.errors";
import { filterFields, WithMetaData } from "../../../utils/helper";
import { QueryOptions, findWithOptions } from "../../../utils/helper";
import { AppContext } from "../../../utils/helper.context";
import { BaseService } from "../../core/base-service";
import { Content, ContentStatusEnum, CreateContentData, UpdateContentData } from "./models";
import ContentCollectionService from "../../content-collection/database/services";
import ajv from "../../../utils/helper.ajv";
import { ValidateFunction } from "ajv";
import { ContentCollection } from "../../content-collection/database/models";

class ContentService extends BaseService {
  private db: Db;
  private collection: Collection<Content>;
  public readonly collectionName = "contents";
  private static readonly ALLOWED_UPDATE_FIELDS: ReadonlySet<keyof UpdateContentData> = new Set(["data", "status"] as const);
  private contentCollectionService: ContentCollectionService;

  constructor(context: AppContext) {
    super(context);
    this.db = context.mongoDatabase;
    this.collection = this.db.collection<Content>(this.collectionName);
  }

  async init() {
    this.contentCollectionService = this.getService("ContentCollectionService");
  }

  private async createValidation(createData: CreateContentData): Promise<{ validatedData: CreateContentData; contentCollection: ContentCollection }> {
    const { contentCollectionId, data, status } = createData;
    if (!("contentCollectionId" in createData)) {
      throw new ValidationError('"contentCollectionId" field is required');
    }
    if (!("data" in createData)) {
      throw new ValidationError('"data" field is required');
    }
    if (!("status" in createData)) {
      throw new ValidationError('"status" field is required');
    }
    const contentCollection = await this.contentCollectionService.getById(contentCollectionId);
    if (!contentCollection) {
      throw new NotFoundError("Content collection not found");
    }
    let validate: ValidateFunction;
    try {
      validate = ajv.compile(contentCollection.schema);
    } catch (err) {
      throw new Error(`Invalid schema: ${(err as Error).message}`);
    }
    if (!validate(data)) {
      const errorText = ajv.errorsText(validate.errors, { separator: ", " });
      throw new ValidationError(`Data validation failed: ${errorText}`);
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
    const newContent: Content = {
      contentCollectionId: contentCollection._id!,
      data: validatedData.data,
      status: validatedData.status as ContentStatusEnum,
      createdAt: new Date(),
      updatedAt: null,
    };
    const result = await this.collection.insertOne(newContent);
    return { _id: result.insertedId, ...newContent };
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

  async findOne(filter: Partial<Content>, options?: FindOptions<Content>): Promise<Content | null> {
    return await this.collection.findOne(filter, options);
  }

  private async updateValidation(
    contentId: string,
    updateData: UpdateContentData
  ): Promise<{ content: Content; contentCollection: ContentCollection; validatedData: UpdateContentData }> {
    const { data, status } = updateData;

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
    if (!("data" in updateData) && !("status" in updateData)) {
      throw new BadRequestError("No valid fields provided for update");
    }
    if (data !== undefined) {
      const existingData = content.data || {};
      // Use parsed object only if data is a string
      const newData = typeof data === "string" ? JSON.parse(data) : data;
      const allowedKeys = Object.keys(contentCollection.schema.properties);
      const mergedData = { ...existingData };
      for (const key of allowedKeys) {
        if (key in newData) {
          mergedData[key] = newData[key];
        }
      }
      let validate: ValidateFunction;
      try {
        validate = ajv.compile(contentCollection.schema);
      } catch (err) {
        throw new Error(`Invalid schema: ${(err as Error).message}`);
      }

      if (!validate(mergedData)) {
        const errorText = ajv.errorsText(validate.errors, { separator: ", " });
        throw new ValidationError(`Data validation failed: ${errorText}`);
      }

      // Use the merged data for the update
      updateData.data = JSON.stringify(mergedData);
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
      ...(validatedData.data ? { data: JSON.parse(validatedData.data) } : {}),
    };
    const updatedContent = await this.collection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: updatingFields, $currentDate: { updatedAt: true } },
      { returnDocument: "after" }
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
