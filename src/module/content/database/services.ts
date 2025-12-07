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
import ajv, { filterSchemaByLocalizable, preValidateComponentPlaceholders, recursiveReplace } from "../../../utils/helper.ajv";
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

    const { shared, translation } = this.separateTranslatableFields(validatedData.data, fullSchema, newContent._id);

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
    const { shared, translation } = this.separateTranslatableFields(validatedData.data, fullSchema, content._id);

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

  /**
   * Recursively separates shared vs translatable fields based on the schema
   */
  separateTranslatableFields(data: any, schema: any, contentId: ObjectId): { shared: any; translation: any } {
    if (!schema) return { shared: data, translation: {} };

    // ARRAY case
    if (schema.type === "array" && schema.items) {
      const validArray = Array.isArray(data) ? data.filter((item) => item != null) : [];
      const sharedArr: any[] = [];
      const transArr: any[] = [];

      for (const item of validArray) {
        const separated = this.separateTranslatableFields(item, schema.items, contentId);
        if (separated.shared && Object.keys(separated.shared).length > 0) sharedArr.push(separated.shared);
        if (separated.translation && Object.keys(separated.translation).length > 0) transArr.push(separated.translation);
      }

      return { shared: sharedArr, translation: transArr };
    }

    // OBJECT case
    if (schema.type === "object") {
      if (!data || typeof data !== "object") return { shared: null, translation: null };

      const shared: any = {};
      const translation: any = {};

      for (const key of Object.keys(data)) {
        const fieldValue = data[key];
        const fieldSchema = schema.properties?.[key];

        if (!fieldSchema) {
          shared[key] = fieldValue;
          continue;
        }

        // nested object or array
        if (fieldSchema.type === "object" || fieldSchema.type === "array") {
          const separated = this.separateTranslatableFields(fieldValue, fieldSchema, contentId);
          if (separated.shared !== null) shared[key] = separated.shared;
          if (separated.translation !== null) translation[key] = separated.translation;
          continue;
        }

        // primitive fields
        if (fieldSchema.localizable) {
          translation[key] = fieldValue;
        } else {
          shared[key] = fieldValue;
        }
      }

      // Inject contentId for the object itself
      shared.contentId = contentId;

      if (Object.keys(shared).length === 0 && Object.keys(translation).length === 0) {
        return { shared: null, translation: null };
      }

      return { shared, translation };
    }

    // primitive fallback
    return { shared: data, translation: {} };
  }

  mergeTranslatableFields(shared: any, translation: any, schema: any): any {
    if (!schema) return {};

    // ARRAY case
    if (schema.type === "array" && schema.items) {
      const sharedArr = Array.isArray(shared) ? shared : [];
      const transArr = Array.isArray(translation) ? translation : [];

      // Build a map of translation items by contentId
      const translationMap = new Map<string, any>();
      transArr.forEach((t) => {
        if (t && t.contentId) translationMap.set(t.contentId.toString(), t);
      });

      // Merge shared items with translation by contentId
      return sharedArr.map((sItem) => {
        const tItem = sItem.contentId ? translationMap.get(sItem.contentId.toString()) : {};
        return this.mergeTranslatableFields(sItem, tItem, schema.items);
      });
    }

    // OBJECT case
    if (schema.type === "object") {
      if ((!shared || typeof shared !== "object") && (!translation || typeof translation !== "object")) {
        return null;
      }

      const result: any = {};
      for (const key of Object.keys(schema.properties || {})) {
        const fieldSchema = schema.properties[key];
        if (!fieldSchema) continue;

        const sValue = shared?.[key] ?? null;
        const tValue = translation?.[key] ?? null;

        if (fieldSchema.type === "object" || fieldSchema.type === "array") {
          const mergedValue = this.mergeTranslatableFields(sValue, tValue, fieldSchema);
          if (mergedValue !== null && (typeof mergedValue !== "object" || Object.keys(mergedValue).length > 0)) {
            result[key] = mergedValue;
          }
        } else {
          // primitive
          if (fieldSchema.localizable) {
            if (tValue !== undefined && tValue !== null) result[key] = tValue;
          } else {
            if (sValue !== undefined && sValue !== null) result[key] = sValue;
          }
        }
      }

      return Object.keys(result).length > 0 ? result : null;
    }

    // PRIMITIVE fallback
    if (schema.localizable) return translation ?? null;
    return shared ?? null;
  }
}

export default ContentService;
