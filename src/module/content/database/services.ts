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
import AttributeService from "../../attribute/database/services";
import { ValidateFunction } from "ajv";
import ajv from "../../../utils/helper.ajv";
import { CreateContentTranslationData } from "../../content-translation/database/models";
import { TenantLocale } from "../../tenant-locale/database/models";
import TenantLocaleService from "../../tenant-locale/database/services";

class ContentService extends BaseService {
  private db: Db;
  private collection: Collection<Content>;
  public readonly collectionName = "contents";
  private static readonly ALLOWED_UPDATE_FIELDS: ReadonlySet<keyof UpdateContentData> = new Set(["status"] as const);
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

  private async createValidation(
    createData: CreateContentData,
    contentCollection: ContentCollection,
  ): Promise<{ validatedData: CreateContentData; schema: any }> {
    const { status, data } = createData;
    if (!("status" in createData)) {
      throw new ValidationError('"status" field is required');
    }
    if (!Object.values(ContentStatusEnum).includes(status as ContentStatusEnum)) {
      throw new ValidationError(`Status type must be one of: ${Object.values(ContentStatusEnum).join(", ")}`);
    }
    const fullSchema = await this.attributeService.getValidationSchema(contentCollection);
    let validate: ValidateFunction;
    console.dir({ fullSchema }, { depth: null, colors: true });
    try {
      if (!fullSchema) {
        throw new Error("fullSchema is missing");
      }
      validate = ajv.compile(fullSchema);
    } catch (err) {
      throw new Error(`Invalid schema: ${(err as Error).message}`);
    }

    if (!validate(data)) {
      const errorText = ajv.errorsText(validate.errors, { separator: ", " });
      throw new ValidationError(`Data validation failed: ${errorText}`);
    }

    return { validatedData: createData, schema: fullSchema };
  }

  async create(data: CreateContentData, contentCollection: ContentCollection): Promise<Content> {
    const { validatedData, schema } = await this.createValidation(data, contentCollection);
    const userId = getCurrentUserId(this.context);
    console.log({ createData: data });
    const { shared, translation } = this.separateTranslatableFields(validatedData.data, schema);
    const newContent: Content = {
      _id: new ObjectId(),
      tenantId: contentCollection.tenantId,
      contentCollectionId: contentCollection._id!,
      status: validatedData.status as ContentStatusEnum,
      data: shared,
      createdAt: new Date(),
      updatedAt: null,
      createdBy: userId,
    };
    await this.collection.insertOne(newContent);
    if (Object.keys(translation).length > 0) {
      try {
        const contentTranslationDto: CreateContentTranslationData = {
          data: translation,
          tenantId: contentCollection.tenantId.toString(),
          status: ContentStatusEnum.PUBLISHED,
        };
        const tenantLocale = await this.tenantLocaleService.findOne({ tenantId: contentCollection.tenantId, isDefault: true });
        if (!tenantLocale) {
          throw new NotFoundError("tenantLocale not found");
        }
        await this.contentTranslationService.create(contentTranslationDto, contentCollection, newContent, tenantLocale, schema);
      } catch (err) {
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

  /**
   * Recursively separates shared vs translatable fields based on the schema
   */
  separateTranslatableFields(data: any, schema: any): { shared: any; translation: any } {
    const shared: any = {};
    const translation: any = {};

    for (const key of Object.keys(data)) {
      const fieldValue = data[key];
      const fieldSchema = schema.properties?.[key];

      if (!fieldSchema) {
        // field not in schema, skip or treat as shared
        shared[key] = fieldValue;
        continue;
      }

      if (fieldSchema.type === "component") {
        if (!fieldValue) continue;

        if (fieldSchema.repeatable) {
          // array of components
          const sharedArr: any[] = [];
          const transArr: any[] = [];
          for (const item of fieldValue) {
            const separated = this.separateTranslatableFields(item, fieldSchema.items);
            sharedArr.push(separated.shared);
            transArr.push(separated.translation);
          }
          shared[key] = sharedArr;
          translation[key] = transArr;
        } else {
          // single component
          const separated = this.separateTranslatableFields(fieldValue, fieldSchema);
          shared[key] = separated.shared;
          translation[key] = separated.translation;
        }
      } else {
        // primitive field
        if (fieldSchema.localizable) {
          translation[key] = fieldValue;
        } else {
          shared[key] = fieldValue;
        }
      }
    }

    return { shared, translation };
  }

  mergeTranslatableFields(shared: any, translation: any, schema: any): any {
    if (!schema || schema.type !== "object") {
      throw new Error("Invalid schema for merging");
    }

    const result: any = {};

    for (const key of Object.keys(schema.properties || {})) {
      const fieldSchema = schema.properties[key];

      if (!fieldSchema) continue;

      // COMPONENT
      if (fieldSchema.type === "component") {
        if (fieldSchema.repeatable) {
          const sharedArr = shared[key] || [];
          const transArr = translation[key] || [];
          if (sharedArr.length !== transArr.length) {
            throw new Error(`Component array length mismatch for key: ${key}`);
          }
          result[key] = sharedArr.map((sItem: any, idx: number) => this.mergeTranslatableFields(sItem, transArr[idx], fieldSchema.items));
        } else {
          result[key] = this.mergeTranslatableFields(shared[key] || {}, translation[key] || {}, fieldSchema);
        }
      }
      // PRIMITIVE
      else {
        if (fieldSchema.localizable) {
          if (!(key in translation)) {
            throw new Error(`Missing translatable field: ${key}`);
          }
          result[key] = translation[key];
        } else {
          if (!(key in shared)) {
            throw new Error(`Missing shared field: ${key}`);
          }
          result[key] = shared[key];
        }
      }
    }

    return result;
  }
}

export default ContentService;
