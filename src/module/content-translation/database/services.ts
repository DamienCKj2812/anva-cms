import { ObjectId, Db, Collection, FindOptions, Filter, UpdateFilter, UpdateOptions, UpdateResult } from "mongodb";
import { validateObjectId } from "../../../utils/helper.mongo";
import { BadRequestError, NotFoundError, ValidationError } from "../../../utils/helper.errors";
import { filterFields, WithMetaData } from "../../../utils/helper";
import { QueryOptions, findWithOptions } from "../../../utils/helper";
import { AppContext } from "../../../utils/helper.context";
import { BaseService } from "../../core/base-service";
import { ContentTranslation, CreateContentTranslationData, FullContentTranslation, UpdateContentTranslationData } from "./models";
import ajv, { preValidateComponentPlaceholders, recursiveReplace } from "../../../utils/helper.ajv";
import { ValidateFunction } from "ajv";
import { ContentCollection } from "../../content-collection/database/models";
import { getCurrentUserId } from "../../../utils/helper.auth";
import { Content, ContentStatusEnum } from "../../content/database/models";
import AttributeService from "../../attribute/database/services";
import { TenantLocale } from "../../tenant-locale/database/models";
import ContentService from "../../content/database/services";

class ContentTranslationService extends BaseService {
  private db: Db;
  private collection: Collection<ContentTranslation>;
  public readonly collectionName = "content-translations";
  private static readonly ALLOWED_UPDATE_FIELDS: ReadonlySet<keyof UpdateContentTranslationData> = new Set(["data", "status"] as const);
  private attributeService: AttributeService;
  private contentService: ContentService;

  constructor(context: AppContext) {
    super(context);
    this.db = context.mongoDatabase;
    this.collection = this.db.collection<ContentTranslation>(this.collectionName);
  }

  async init() {
    this.attributeService = this.getService("AttributeService");
    this.contentService = this.getService("ContentService");
  }

  private async createValidation(
    createData: CreateContentTranslationData,
    content: Content,
    tenantLocale: TenantLocale,
    contentCollection: ContentCollection,
    fullSchema: any,
  ): Promise<{ validatedData: CreateContentTranslationData }> {
    const { data, status } = createData;

    if (!data) throw new ValidationError('"data" field is required');
    if (!status) throw new ValidationError('"status" field is required');

    const existingTranslation = await this.findOne({ tenantLocaleId: tenantLocale._id, contentId: content._id });
    if (existingTranslation) {
      throw new ValidationError(`Content already have the locale, please change another locale: ${existingTranslation.locale}`);
    }
    if (!fullSchema) {
      throw new ValidationError("Content collection schema is missing");
    }

    // Use mergeTranslatableFields to combine shared and translation safely
    let mergedData: any;
    try {
      mergedData = this.contentService.mergeTranslatableFields(content.data, data, fullSchema);
    } catch (err) {
      throw new ValidationError(`Failed to merge translation: ${(err as Error).message}`);
    }

    // Validate merged data against full schema
    let validate: ValidateFunction;
    try {
      preValidateComponentPlaceholders(fullSchema);
      validate = ajv.compile(fullSchema);
    } catch (err) {
      throw new Error(`Invalid schema: ${(err as Error).message}`);
    }

    console.dir({ mergedData }, { depth: null, colors: true });
    if (!validate(mergedData)) {
      const errorText = ajv.errorsText(validate.errors, { separator: ", " });
      throw new ValidationError(`Data validation failed: ${errorText}`);
    }

    if (!Object.values(ContentStatusEnum).includes(status as ContentStatusEnum)) {
      throw new ValidationError(`Status type must be one of: ${Object.values(ContentStatusEnum).join(", ")}`);
    }

    return { validatedData: { ...createData, data: mergedData } };
  }

  async create(
    data: CreateContentTranslationData,
    contentCollection: ContentCollection,
    content: Content,
    tenantLocale: TenantLocale,
    fullSchema: any,
  ): Promise<ContentTranslation> {
    const { validatedData } = await this.createValidation(data, content, tenantLocale, contentCollection, fullSchema);
    const userId = getCurrentUserId(this.context);

    const { shared, translation } = this.contentService.separateTranslatableFields(validatedData.data, fullSchema);
    console.log({ shared });

    const newContent: ContentTranslation = {
      _id: new ObjectId(),
      contentCollectionId: contentCollection._id,
      tenantLocaleId: tenantLocale._id,
      contentId: content._id,
      locale: tenantLocale.locale,
      data: translation, // safely merged
      status: validatedData.status as ContentStatusEnum,
      isDefault: tenantLocale.isDefault,
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
    lookup?: "content"[];
    sort?: Record<string, 1 | -1>;
  }): Promise<FullContentTranslation[]> {
    const pipeline: any[] = [{ $match: match }];

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
    updateData: UpdateContentTranslationData,
    contentTranslation: ContentTranslation,
    contentCollection: ContentCollection,
    content: Content,
    fullSchema: any,
  ): Promise<{
    validatedData: UpdateContentTranslationData;
  }> {
    const { data, status } = updateData;
    console.log({ updateData });

    if (!("data" in updateData) && !("status" in updateData)) {
      throw new BadRequestError("No valid fields provided for update");
    }

    if (data !== undefined) {
      if (!fullSchema) {
        throw new Error("Content collection schema is missing");
      }

      const nonTranslatableFound = await this.attributeService.findMany({
        contentCollectionId: content.contentCollectionId,
        key: { $in: Object.keys(data) },
        localizable: false,
      });

      if (nonTranslatableFound.length > 0) {
        throw new ValidationError("Some fields are non-translatable");
      }

      let mergedData: any;
      const existingData = contentTranslation.data || {};
      mergedData = { ...existingData };

      // Only update keys provided in ``
      mergedData = recursiveReplace(mergedData, data);

      try {
        mergedData = this.contentService.mergeTranslatableFields(content.data, mergedData, fullSchema);
      } catch (err) {
        throw new ValidationError(`Failed to merge translation: ${(err as Error).message}`);
      }

      let validate: ValidateFunction;
      try {
        preValidateComponentPlaceholders(fullSchema);
        validate = ajv.compile(fullSchema);
      } catch (err) {
        throw new Error(`Invalid schema: ${(err as Error).message}`);
      }

      if (!validate(mergedData)) {
        const errorText = ajv.errorsText(validate.errors, { separator: ", " });
        throw new ValidationError(`Data validation failed: ${errorText}`);
      }

      updateData.data = mergedData;
    }

    // 5️⃣ Validate status if provided
    if (status !== undefined && !Object.values(ContentStatusEnum).includes(status as ContentStatusEnum)) {
      throw new ValidationError(`Status type must be one of: ${Object.values(ContentStatusEnum).join(", ")}`);
    }

    return { validatedData: updateData };
  }

  async update(
    data: UpdateContentTranslationData,
    contentTranslation: ContentTranslation,
    contentCollection: ContentCollection,
    content: Content,
    fullSchema: any,
  ): Promise<ContentTranslation> {
    const filteredUpdateData = filterFields(data, ContentTranslationService.ALLOWED_UPDATE_FIELDS);

    const { validatedData } = await this.updateValidation(filteredUpdateData, contentTranslation, contentCollection, content, fullSchema);
    console.log({ validatedData: validatedData });

    const updatingFields: Partial<ContentTranslation> = {
      ...validatedData,
      status: validatedData.status as ContentStatusEnum,
      ...(validatedData.data ? { data: typeof validatedData.data === "string" ? JSON.parse(validatedData.data) : validatedData.data } : {}),
    };

    const updatedContent = await this.collection.findOneAndUpdate(
      { _id: contentTranslation._id },
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
