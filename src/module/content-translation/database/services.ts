import { ObjectId, Db, Collection, FindOptions, Filter, UpdateFilter, UpdateOptions, UpdateResult } from "mongodb";
import { validateObjectId } from "../../../utils/helper.mongo";
import { BadRequestError, NotFoundError, ValidationError } from "../../../utils/helper.errors";
import { filterFields, WithMetaData } from "../../../utils/helper";
import { QueryOptions, findWithOptions } from "../../../utils/helper";
import { AppContext } from "../../../utils/helper.context";
import { BaseService } from "../../core/base-service";
import { ContentTranslation, CreateContentTranslationData, FullContentTranslation, UpdateContentTranslationData } from "./models";
import ajv, { preValidateComponentPlaceholders, separateTranslatableFields, splitSchemaByLocalizable } from "../../../utils/helper.ajv";
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

  getCollection(): Collection<ContentTranslation> {
    return this.collection;
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
      throw new ValidationError(`Content already has the locale, please choose another locale: ${existingTranslation.locale}`);
    }

    if (!fullSchema) throw new ValidationError("Content collection schema is missing");

    const { localizableSchema } = splitSchemaByLocalizable(fullSchema);
    const { translation } = separateTranslatableFields(data, fullSchema);
    createData.data = translation;

    try {
      preValidateComponentPlaceholders(localizableSchema);
    } catch (err) {
      throw new ValidationError(err instanceof Error ? err.message : String(err));
    }

    let validate: ValidateFunction;
    try {
      validate = ajv.compile(localizableSchema);
    } catch (err) {
      throw new Error(`Invalid schema: ${(err as Error).message}`);
    }

    if (!validate(translation)) {
      const errorText = ajv.errorsText(validate.errors, { separator: ", " });
      throw new ValidationError(`Data validation failed: ${errorText}`);
    }

    if (!Object.values(ContentStatusEnum).includes(status as ContentStatusEnum)) {
      throw new ValidationError(`Status type must be one of: ${Object.values(ContentStatusEnum).join(", ")}`);
    }

    return { validatedData: { ...createData, data } };
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

    // Inject contentId for nested components
    const newContent: ContentTranslation = {
      _id: new ObjectId(),
      contentCollectionId: contentCollection._id,
      tenantLocaleId: tenantLocale._id,
      contentId: content._id,
      locale: tenantLocale.locale,
      data: validatedData.data, // only localizable fields
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
  ): Promise<{ validatedData: UpdateContentTranslationData }> {
    const { data, status } = updateData;

    if (!("data" in updateData) && !("status" in updateData)) {
      throw new BadRequestError("No valid fields provided for update");
    }

    if (data !== undefined) {
      if (!fullSchema) throw new Error("Content collection schema is missing");

      // Filter schema to only localizable fields
      const { localizableSchema } = splitSchemaByLocalizable(fullSchema);
      const { translation } = separateTranslatableFields(data, fullSchema);
      updateData.data = translation;

      // Validate against filtered schema
      try {
        preValidateComponentPlaceholders(localizableSchema);
      } catch (err) {
        throw new ValidationError(err instanceof Error ? err.message : String(err));
      }

      let validate: ValidateFunction;
      try {
        validate = ajv.compile(translation);
      } catch (err) {
        throw new Error(`Invalid schema: ${(err as Error).message}`);
      }

      if (!validate(data)) {
        const errorText = ajv.errorsText(validate.errors, { separator: ", " });
        throw new ValidationError(`Data validation failed: ${errorText}`);
      }
    }

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

    // Inject contentId for nested components
    const { translation } = separateTranslatableFields(validatedData.data, fullSchema);

    const updatingFields: Partial<ContentTranslation> = {
      ...validatedData,
      status: validatedData.status as ContentStatusEnum,
      data: translation, // only localizable fields
    };

    const updatedContent = await this.collection.findOneAndUpdate(
      { _id: contentTranslation._id },
      { $set: updatingFields, $currentDate: { updatedAt: true } },
      { returnDocument: "after" },
    );

    if (!updatedContent) throw new NotFoundError("Failed to update content translation");

    return updatedContent;
  }

  async updateMany(
    filter: Filter<ContentTranslation>,
    update: UpdateFilter<ContentTranslation> | Document[],
    options?: UpdateOptions,
  ): Promise<UpdateResult<ContentTranslation>> {
    return await this.collection.updateMany(filter, update, options);
  }

  async delete(contentTranslation: ContentTranslation): Promise<ContentTranslation> {
    await this.collection.deleteOne({ _id: contentTranslation._id });
    return contentTranslation;
  }
}

export default ContentTranslationService;
