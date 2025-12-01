import { ObjectId, Db, Collection, FindOptions } from "mongodb";
import { validateObjectId } from "../../../utils/helper.mongo";
import { BadRequestError, NotFoundError, ValidationError } from "../../../utils/helper.errors";
import { filterFields, WithMetaData } from "../../../utils/helper";
import { QueryOptions, findWithOptions } from "../../../utils/helper";
import { AppContext } from "../../../utils/helper.context";
import { BaseService } from "../../core/base-service";
import { ContentTranslation, CreateContentTranslationData, FullContentTranslation, UpdateContentTranslationData } from "./models";
import ContentCollectionService from "../../content-collection/database/services";
import ajv from "../../../utils/helper.ajv";
import { ValidateFunction } from "ajv";
import { ContentCollection } from "../../content-collection/database/models";
import { getCurrentUserId } from "../../../utils/helper.auth";
import TenantLocaleService from "../../tenant-locale/database/services";
import { Content, ContentStatusEnum } from "../../content/database/models";

class ContentTranslationService extends BaseService {
  private db: Db;
  private collection: Collection<ContentTranslation>;
  public readonly collectionName = "content-translations";
  private static readonly ALLOWED_UPDATE_FIELDS: ReadonlySet<keyof UpdateContentTranslationData> = new Set(["data", "status"] as const);
  private contentCollectionService: ContentCollectionService;
  private tenantLocaleService: TenantLocaleService

  constructor(context: AppContext) {
    super(context);
    this.db = context.mongoDatabase;
    this.collection = this.db.collection<ContentTranslation>(this.collectionName);
  }

  async init() {
    this.contentCollectionService = this.getService("ContentCollectionService");
    this.tenantLocaleService = this.getService("TenantLocaleService")
  }

  private async createValidation(createData: CreateContentTranslationData, contentCollection: ContentCollection): Promise<{ validatedData: CreateContentTranslationData; }> {
    const { data, status, locale } = createData;

    if (!("data" in createData)) {
      throw new ValidationError('"data" field is required');
    }
    if (!("status" in createData)) {
      throw new ValidationError('"status" field is required');
    }
    if (!("locale" in createData)) {
      throw new ValidationError('"locale" field is required');
    }
    let validate: ValidateFunction;
    console.log({ schema: contentCollection.schema })
    try {
      if (!contentCollection.schema) {
        throw new Error("Content collection schema is missing");
      }
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
    const tenantLocale = await this.tenantLocaleService.findOne({ tenantId: new ObjectId(contentCollection.tenantId), locale: locale })
    if (!tenantLocale) {
      throw new ValidationError(`current ${locale} is not supported`);
    }
    return {
      validatedData: createData,
    };
  }

  async create(data: CreateContentTranslationData, contentCollection: ContentCollection, content: Content): Promise<ContentTranslation> {
    const { validatedData } = await this.createValidation(data, contentCollection);
    const userId = getCurrentUserId(this.context)
    const newContent: ContentTranslation = {
      _id: new ObjectId(),
      contentCollectionId: content.contentCollectionId,
      contentId: content._id,
      locale: validatedData.locale,
      data: validatedData.data,
      status: validatedData.status as ContentStatusEnum,
      createdAt: new Date(),
      updatedAt: null,
      createdBy: userId,
    };

    await this.collection.insertOne(newContent);

    return newContent
  }


  async list({
    match,
    lookup,
    sort,
  }: {
    match: Partial<ContentTranslation>;
    lookup?: ("contentCollection" | "content")[];
    sort?: Record<string, 1 | -1>;
  }): Promise<FullContentTranslation[]> {
    const pipeline: any[] = [{ $match: match }];

    if (!lookup?.includes("contentCollection")) {
      pipeline.push(
        {
          $lookup: {
            from: "content-collections",
            localField: "contentCollectionId",
            foreignField: "_id",
            as: "contentCollection",
          },
        },
        { $unwind: { path: "$contentCollection", preserveNullAndEmptyArrays: true } }
      );
    }

    if (!lookup?.includes("content")) {
      pipeline.push(
        {
          $lookup: {
            from: "contents",
            localField: "contentId",
            foreignField: "_id",
            as: "content",
          },
        },
        { $unwind: { path: "$content", preserveNullAndEmptyArrays: true } }
      );
    }

    if (sort && Object.keys(sort).length > 0) {
      pipeline.push({ $sort: sort });
    }

    const res = await this.collection.aggregate(pipeline).toArray();
    return res as FullContentTranslation[];
  }

  async getAll(queryOptions: QueryOptions): Promise<WithMetaData<ContentTranslation>> {
    const options = {
      ...queryOptions,
      filter: {
        ...(queryOptions.filter || {}),
      },
    };
    return await findWithOptions(this.collection, options);
  }

  async getById(id: string): Promise<ContentTranslation | null> {
    validateObjectId(id);
    return await this.collection.findOne({ _id: new ObjectId(id) });
  }


  async findOne(filter: Partial<ContentTranslation>, options?: FindOptions<ContentTranslation>): Promise<Content | null> {
    return await this.collection.findOne(filter, options);
  }

  private async updateValidation(
    contentTranslationId: string,
    updateData: UpdateContentTranslationData
  ): Promise<{ contentTranslation: ContentTranslation; contentCollection: ContentCollection; validatedData: UpdateContentTranslationData }> {
    const { data, status } = updateData;

    if (!contentTranslationId) {
      throw new BadRequestError("Missing content Id");
    }
    const contentTranslation = await this.getById(contentTranslationId);
    if (!contentTranslation) {
      throw new NotFoundError("Content not found");
    }
    const contentCollection = await this.contentCollectionService.getById(contentTranslation?.contentCollectionId.toString());
    if (!contentCollection) {
      throw new NotFoundError("Content collection not found");
    }
    if (!("data" in updateData) && !("status" in updateData)) {
      throw new BadRequestError("No valid fields provided for update");
    }
    if (!contentCollection.schema) {
      throw new Error("Content collection schema is missing");
    }
    if (data !== undefined) {
      const existingData = contentTranslation.data || {};
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

    return { contentTranslation, contentCollection, validatedData: updateData };
  }

  async update(id: string, data: UpdateContentTranslationData): Promise<ContentTranslation> {
    validateObjectId(id);
    const filteredUpdateData = filterFields(data, ContentTranslationService.ALLOWED_UPDATE_FIELDS);
    const { contentTranslation, contentCollection, validatedData } = await this.updateValidation(id, filteredUpdateData);
    const updatingFields: Partial<ContentTranslation> = {
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

  private async deleteValidation(id: string): Promise<ContentTranslation> {
    const content = await this.collection.findOne({ _id: new ObjectId(id) }, { projection: { name: 1 } });
    if (!content) {
      throw new NotFoundError("content not found");
    }
    return content;
  }

  async delete(id: string): Promise<ContentTranslation> {
    const content = await this.deleteValidation(id);
    await this.collection.deleteOne({ _id: content._id });
    return content;
  }
}

export default ContentTranslationService;
