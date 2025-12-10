import { ObjectId, Db, Collection, FindOptions, Filter } from "mongodb";
import { validateObjectId } from "../../../utils/helper.mongo";
import { BadRequestError, NotFoundError, ValidationError } from "../../../utils/helper.errors";
import { filterFields, WithMetaData } from "../../../utils/helper";
import { QueryOptions, findWithOptions } from "../../../utils/helper";
import { AppContext } from "../../../utils/helper.context";
import { BaseService } from "../../core/base-service";
import { Content, ContentCount, ContentStatusEnum, CreateContentData, UpdateContentData } from "./models";
import ContentCollectionService from "../../content-collection/database/services";
import { ContentCollection, ContentCollectionTypeEnum } from "../../content-collection/database/models";
import { getCurrentUserId } from "../../../utils/helper.auth";
import ContentTranslationService from "../../content-translation/database/services";
import AttributeService from "../../attribute/database/services";
import { ValidateFunction } from "ajv";
import ajv, {
  filterSchemaByLocalizable,
  preValidateComponentPlaceholders,
  recursiveReplace,
  separateTranslatableFields,
} from "../../../utils/helper.ajv";
import { ContentTranslation, CreateContentTranslationData } from "../../content-translation/database/models";
import TenantLocaleService from "../../tenant-locale/database/services";

class ContentService extends BaseService {
  private db: Db;
  private collection: Collection<Content>;
  public readonly collectionName = "contents";
  private static readonly ALLOWED_UPDATE_FIELDS: ReadonlySet<keyof UpdateContentData> = new Set(["status", "data"] as const);
  private contentCollectionService: ContentCollectionService;
  private contentTranslationService: ContentTranslationService;
  private attributeService: AttributeService;
  private tenantLocaleService: TenantLocaleService;

  constructor(context: AppContext) {
    super(context);
    this.db = context.mongoDatabase;
    this.collection = this.db.collection<Content>(this.collectionName);
  }

  async init() {
    this.contentCollectionService = this.getService("ContentCollectionService");
    this.contentTranslationService = this.getService("ContentTranslationService");
    this.attributeService = this.getService("AttributeService");
    this.tenantLocaleService = this.getService("TenantLocaleService");
  }

  getCollection(): Collection<Content> {
    return this.collection;
  }

  private async createValidation(createData: CreateContentData, contentCollection: ContentCollection, fullSchema: any): Promise<CreateContentData> {
    const { status, data } = createData;
    if (!("status" in createData)) {
      throw new ValidationError('"status" field is required');
    }
    if (!Object.values(ContentStatusEnum).includes(status as ContentStatusEnum)) {
      throw new ValidationError(`Status type must be one of: ${Object.values(ContentStatusEnum).join(", ")}`);
    }
    if (contentCollection.type == ContentCollectionTypeEnum.SINGLE) {
      const existingContent = await this.findOne({ contentCollectionId: contentCollection._id });
      if (existingContent) throw new ValidationError("Current collection is a single type, cannot create more than one content");
    }
    let validate: ValidateFunction;
    try {
      if (!fullSchema) {
        throw new Error("fullSchema is missing");
      }
      preValidateComponentPlaceholders(fullSchema);
      validate = ajv.compile(fullSchema);
    } catch (err) {
      throw new Error(`Invalid schema: ${(err as Error).message}`);
    }
    console.log("creating content");
    console.dir({ data }, { depth: null, colors: true });
    console.dir({ fullSchema }, { depth: null, colors: true });
    if (!validate(data)) {
      const errorText = ajv.errorsText(validate.errors, { separator: ", " });
      throw new ValidationError(`Data validation failed: ${errorText}`);
    }

    return createData;
  }

  async create(data: CreateContentData, contentCollection: ContentCollection, fullSchema: any): Promise<Content> {
    const validatedData = await this.createValidation(data, contentCollection, fullSchema);
    const userId = getCurrentUserId(this.context);

    const newContent: Content = {
      _id: new ObjectId(),
      tenantId: contentCollection.tenantId,
      contentCollectionId: contentCollection._id!,
      status: validatedData.status as ContentStatusEnum,
      data: {}, // we'll fill after separateTranslatableFields
      createdAt: new Date(),
      updatedAt: null,
      createdBy: userId,
    };

    const { shared, translation } = separateTranslatableFields(validatedData.data, fullSchema);

    // Assign shared data now that contentId is injected
    newContent.data = shared;

    await this.collection.insertOne(newContent);

    // Create translation if any
    if (Object.keys(translation).length > 0) {
      try {
        const contentTranslationDto: CreateContentTranslationData = {
          data: translation,
          tenantId: contentCollection.tenantId.toString(),
          status: ContentStatusEnum.PUBLISHED,
        };
        const tenantLocale = await this.tenantLocaleService.findOne({ tenantId: contentCollection.tenantId, isDefault: true });
        if (!tenantLocale) throw new NotFoundError("tenantLocale not found");

        await this.contentTranslationService.create(contentTranslationDto, contentCollection, newContent, tenantLocale, fullSchema);
      } catch (err) {
        // Rollback main content if translation fails
        await this.collection.deleteOne({ _id: newContent._id });
        throw err;
      }
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

  async findMany(filter: Filter<Content>, options?: FindOptions<Content>): Promise<Content[]> {
    return this.collection.find(filter, options).toArray();
  }

  private async updateValidation(content: Content, updateData: UpdateContentData, fullSchema: any): Promise<UpdateContentData> {
    const { data, status } = updateData;

    if (!("data" in updateData || "status" in updateData)) {
      throw new BadRequestError("No valid fields provided for update");
    }

    if (data !== undefined) {
      if (!fullSchema) throw new Error("Content collection schema is missing");

      // Filter schema to only non-localizable fields (shared)
      const filteredSchema = filterSchemaByLocalizable(fullSchema, false);

      // Merge updated fields on top of existing shared data
      const existingData = content.data || {};
      const mergedData = recursiveReplace(existingData, data);

      try {
        preValidateComponentPlaceholders(filteredSchema);
      } catch (err) {
        throw new ValidationError(err instanceof Error ? err.message : String(err));
      }

      let validate: ValidateFunction;
      try {
        validate = ajv.compile(filteredSchema);
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

    return updateData;
  }

  async update(content: Content, data: UpdateContentData, fullSchema: any): Promise<Content> {
    const filteredUpdateData = filterFields(data, ContentService.ALLOWED_UPDATE_FIELDS);

    const validatedData = await this.updateValidation(content, filteredUpdateData, fullSchema);

    // Inject contentId into translatable fields (for consistency)
    const { shared, translation } = separateTranslatableFields(validatedData.data, fullSchema);

    const updatingFields: Partial<Content> = {
      ...validatedData,
      status: validatedData.status as ContentStatusEnum,
      data: shared,
    };

    const updatedContent = await this.collection.findOneAndUpdate(
      { _id: content._id },
      { $set: updatingFields, $currentDate: { updatedAt: true } },
      { returnDocument: "after" },
    );

    if (!updatedContent) throw new NotFoundError("Failed to update content");

    return updatedContent;
  }

  async delete(content: Content): Promise<Content> {
    await this.contentTranslationService.getCollection().deleteMany({ contentId: content._id });
    await this.collection.deleteOne({ _id: content._id });
    return content;
  }
}

export default ContentService;
