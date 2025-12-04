import { ObjectId, Db, Collection, FindOptions, Filter, UpdateFilter, UpdateOptions, UpdateResult } from "mongodb";
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
import AttributeService from "../../attribute/database/services";

class ContentTranslationService extends BaseService {
  private db: Db;
  private collection: Collection<ContentTranslation>;
  public readonly collectionName = "content-translations";
  private static readonly ALLOWED_UPDATE_FIELDS: ReadonlySet<keyof UpdateContentTranslationData> = new Set(["data", "status"] as const);
  private contentCollectionService: ContentCollectionService;
  private tenantLocaleService: TenantLocaleService;
  private attributeService: AttributeService;

  constructor(context: AppContext) {
    super(context);
    this.db = context.mongoDatabase;
    this.collection = this.db.collection<ContentTranslation>(this.collectionName);
  }

  async init() {
    this.contentCollectionService = this.getService("ContentCollectionService");
    this.tenantLocaleService = this.getService("TenantLocaleService");
    this.attributeService = this.getService("AttributeService");
  }

  private async createValidation(
    createData: CreateContentTranslationData,
    contentCollection: ContentCollection,
    content: Content,
  ): Promise<{ validatedData: CreateContentTranslationData }> {
    const { data, status, locale } = createData;

    if (!data) throw new ValidationError('"data" field is required');
    if (!status) throw new ValidationError('"status" field is required');
    if (!locale) throw new ValidationError('"locale" field is required');
    console.log({ data });

    const mergedData = { ...data };
    const defaultTenantLocale = await this.tenantLocaleService.findOne({
      tenantId: contentCollection.tenantId,
      isDefault: true,
    });
    if (!defaultTenantLocale) {
      throw new ValidationError("default tenant locale not found");
    }
    if (locale !== defaultTenantLocale.locale) {
      const inheritAttributes = await this.attributeService.findMany({
        contentCollectionId: contentCollection._id,
        inheritDefault: true,
      });

      if (inheritAttributes.length > 0) {
        const defaultContentTranslation = await this.findOne({
          contentId: content._id,
          locale: defaultTenantLocale.locale,
        });
        if (!defaultContentTranslation) {
          throw new ValidationError("default content translation not found");
        }

        for (const attr of inheritAttributes) {
          const key = attr.key;

          if (!(key in mergedData) || mergedData[key]?.useDefault === true) {
            mergedData[key] = defaultContentTranslation.data[key];
          }
        }
      }
    }
    console.log({ mergedData });
    let validate: ValidateFunction;
    try {
      if (!contentCollection.schema) {
        throw new Error("Content collection schema is missing");
      }
      validate = ajv.compile(contentCollection.schema);
    } catch (err) {
      throw new Error(`Invalid schema: ${(err as Error).message}`);
    }

    if (!validate(mergedData)) {
      const errorText = ajv.errorsText(validate.errors, { separator: ", " });
      throw new ValidationError(`Data validation failed: ${errorText}`);
    }

    if (!Object.values(ContentStatusEnum).includes(status as ContentStatusEnum)) {
      throw new ValidationError(`Status type must be one of: ${Object.values(ContentStatusEnum).join(", ")}`);
    }

    const tenantLocale = await this.tenantLocaleService.findOne({
      tenantId: contentCollection.tenantId,
      locale,
    });

    if (!tenantLocale) {
      throw new ValidationError(`current ${locale} is not supported`);
    }

    const existingTranslation = await this.collection.findOne({
      contentId: content._id,
      locale,
    });

    if (existingTranslation) {
      throw new ValidationError(`current ${locale} is already created`);
    }

    return { validatedData: { ...createData, data: mergedData } };
  }

  async create(data: CreateContentTranslationData, contentCollection: ContentCollection, content: Content): Promise<ContentTranslation> {
    const { validatedData } = await this.createValidation(data, contentCollection, content);
    const userId = getCurrentUserId(this.context);
    const newContent: ContentTranslation = {
      _id: new ObjectId(),
      tenantId: contentCollection.tenantId,
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

    return newContent;
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

    if (lookup?.includes("contentCollection")) {
      pipeline.push(
        {
          $lookup: {
            from: "content-collections",
            localField: "contentCollectionId",
            foreignField: "_id",
            as: "contentCollection",
          },
        },
        { $unwind: { path: "$contentCollection", preserveNullAndEmptyArrays: true } },
      );
    }

    if (lookup?.includes("content")) {
      pipeline.push(
        {
          $lookup: {
            from: "contents",
            localField: "contentId",
            foreignField: "_id",
            as: "content",
          },
        },
        { $unwind: { path: "$content", preserveNullAndEmptyArrays: true } },
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

  async findOne(filter: Partial<ContentTranslation>, options?: FindOptions<ContentTranslation>): Promise<ContentTranslation | null> {
    return await this.collection.findOne(filter, options);
  }

  async findMany(filter: Filter<ContentTranslation>, options?: FindOptions<ContentTranslation>): Promise<ContentTranslation[]> {
    return this.collection.find(filter, options).toArray();
  }

  private async updateValidation(
    contentTranslationId: string,
    updateData: UpdateContentTranslationData,
  ): Promise<{
    contentTranslation: ContentTranslation;
    contentCollection: ContentCollection;
    validatedData: UpdateContentTranslationData;
  }> {
    const { data, status } = updateData;
    if (!contentTranslationId) {
      throw new BadRequestError("Missing content Id");
    }
    const contentTranslation = await this.getById(contentTranslationId);
    if (!contentTranslation) {
      throw new NotFoundError("Content not found");
    }
    const contentCollection = await this.contentCollectionService.getById(contentTranslation.contentCollectionId.toString());
    if (!contentCollection) {
      throw new NotFoundError("Content collection not found");
    }
    if (!("data" in updateData) && !("status" in updateData)) {
      throw new BadRequestError("No valid fields provided for update");
    }
    if (!contentCollection.schema) {
      throw new Error("Content collection schema is missing");
    }
    const defaultTenantLocale = await this.tenantLocaleService.findOne({
      tenantId: contentCollection.tenantId,
      isDefault: true,
    });
    if (!defaultTenantLocale) {
      throw new ValidationError("default tenant locale not found");
    }
    const isDefaultLocale = contentTranslation.locale === defaultTenantLocale.locale;
    if (data !== undefined) {
      const existingData = contentTranslation.data || {};
      const newData = typeof data === "string" ? JSON.parse(data) : data;
      const mergedData: Record<string, any> = { ...existingData };
      if (isDefaultLocale) {
        Object.assign(mergedData, newData);
      } else {
        const updatableAttributes = await this.attributeService.findMany({
          contentCollectionId: contentCollection._id,
          inheritDefault: false,
        });
        const updatableKeys = updatableAttributes.map((attr) => attr.key);

        for (const key of updatableKeys) {
          if (key in newData) mergedData[key] = newData[key];
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
      updateData.data = mergedData;
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
      { returnDocument: "after" },
    );
    if (!updatedContent) {
      throw new NotFoundError("failed to update content");
    }

    return updatedContent;
  }

  async updateMany(
    filter: Filter<ContentTranslation>,
    update: UpdateFilter<ContentTranslation> | Document[],
    options?: UpdateOptions,
  ): Promise<UpdateResult<ContentTranslation>> {
    return await this.collection.updateMany(filter, update, options);
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
