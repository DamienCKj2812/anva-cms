import { ObjectId, Db, Collection, FindOptions, Filter, Document } from "mongodb";
import { getCurrentUserId } from "../../../utils/helper.auth";
import { validateObjectId } from "../../../utils/helper.mongo";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../../utils/helper.errors";
import { filterFields, WithMetaData } from "../../../utils/helper";
import { AppContext } from "../../../utils/helper.context";
import { ContentCollection, ContentCollectionTypeEnum, CreateContentCollectionData, UpdateContentCollectionData } from "./models";
import TenantService from "../../tenant/database/services";
import { Attribute, AttributeKindEnum } from "../../attribute/database/models";
import { BaseService } from "../../core/base-service";
import AttributeService from "../../attribute/database/services";
import ContentService from "../../content/database/services";
import AttributeComponentService from "../../attribute-component/database/services";
import { castPrimitive } from "../../../utils/helper.ajv";

class ContentCollectionService extends BaseService {
  private db: Db;
  private collection: Collection<ContentCollection>;
  public readonly collectionName = "content-collections";
  private static readonly ALLOWED_UPDATE_FIELDS: ReadonlySet<keyof UpdateContentCollectionData> = new Set(["slug", "displayName"] as const);
  private tenantService: TenantService;
  private attributeService: AttributeService;
  private contentService: ContentService;
  private attributeComponentService: AttributeComponentService;

  constructor(context: AppContext) {
    super(context);
    this.db = context.mongoDatabase;
    this.collection = this.db.collection<ContentCollection>(this.collectionName);
  }

  async init() {
    this.tenantService = this.getService("TenantService");
    this.attributeService = this.getService("AttributeService");
    this.contentService = this.getService("ContentService");
    this.attributeComponentService = this.getService("AttributeComponentService");
  }

  getCollection(): Collection<ContentCollection> {
    return this.collection;
  }

  private async createValidation(data: CreateContentCollectionData): Promise<CreateContentCollectionData> {
    const { tenantId, slug, displayName, type } = data;
    const userId = getCurrentUserId(this.context);
    if (!("tenantId" in data)) {
      throw new ValidationError('"tenantId" field is required');
    }
    if (!("slug" in data)) {
      throw new ValidationError('"slug" field is required');
    }
    if (!("displayName" in data)) {
      throw new ValidationError('"displayName" field is required');
    }
    if (!("type" in data)) {
      throw new ValidationError('"type" field is required');
    }
    validateObjectId(tenantId);
    const tenant = await this.tenantService.getById(tenantId);
    if (!tenant) {
      throw new NotFoundError("Tenant not found");
    }
    if (!tenant.createdBy.equals(userId)) {
      throw new ForbiddenError("You are not allowed to access this resources");
    }
    if (typeof slug !== "string" || !slug.trim()) {
      throw new ValidationError("slug must be a non-empty string");
    }
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/i.test(slug)) {
      throw new ValidationError("slug can only contain letters, numbers, and single hyphens (no spaces)");
    }
    const existingCollection = await this.collection.findOne({
      slug: slug.trim(),
      createdBy: userId,
    });
    if (existingCollection) {
      throw new ConflictError("Content collection already exists");
    }
    if (typeof displayName !== "string" || !displayName.trim()) {
      throw new ValidationError("displayName must be a non-empty string");
    }
    if (!Object.values(ContentCollectionTypeEnum).includes(type)) {
      throw new ValidationError(`collection type must be one of: ${Object.values(ContentCollectionTypeEnum).join(", ")}`);
    }

    return data;
  }

  async create(data: CreateContentCollectionData): Promise<ContentCollection> {
    const { tenantId, slug, displayName, type } = await this.createValidation(data);
    const createdBy = getCurrentUserId(this.context);

    console.log("Creating :", slug);
    const newContentCollection: ContentCollection = {
      _id: new ObjectId(),
      tenantId: new ObjectId(tenantId),
      slug: slug.trim(),
      displayName: displayName.trim(),
      type,
      schema: null,
      createdAt: new Date(),
      createdBy,
    };

    await this.collection.insertOne(newContentCollection);
    return newContentCollection;
  }

  async getAll(): Promise<(ContentCollection & { contentCount: number })[]> {
    const userId = getCurrentUserId(this.context);

    const [contentCollections, contentCounts] = await Promise.all([
      this.findMany({ createdBy: userId }),
      this.contentService.getContentCount(userId),
    ]);

    const countMap = new Map<string, number>(contentCounts.map((c) => [c._id.toString(), c.count]));

    const merged = contentCollections.map((c) => ({
      ...c,
      contentCount: countMap.get(c._id!.toString()) ?? 0,
    }));

    return merged;
  }

  async getById(id: string): Promise<ContentCollection | null> {
    validateObjectId(id);
    return await this.collection.findOne({ _id: new ObjectId(id) });
  }

  async findOne(filter: Partial<ContentCollection>, options?: FindOptions<ContentCollection>): Promise<ContentCollection | null> {
    return await this.collection.findOne(filter, options);
  }

  async findMany(filter: Filter<ContentCollection>, options?: FindOptions<ContentCollection>): Promise<ContentCollection[]> {
    return this.collection.find(filter, options).toArray();
  }

  private async updateValidation(contentCollection: ContentCollection, data: UpdateContentCollectionData): Promise<UpdateContentCollectionData> {
    const { slug, displayName } = data;
    let updateData: UpdateContentCollectionData = { ...data };
    let userId = getCurrentUserId(this.context);

    if (!("slug" in data) && !("displayName" in data)) {
      throw new BadRequestError("No valid fields provided for update");
    }

    if ("slug" in data) {
      if (typeof slug !== "string" || !slug.trim()) {
        throw new ValidationError("slug must be a non-empty string");
      }
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/i.test(slug)) {
        throw new ValidationError("slug can only contain letters, numbers, and single hyphens (no spaces)");
      }
      const existingCollection = await this.collection.findOne({
        slug: slug.trim(),
        createdBy: userId,
      });
      if (existingCollection) {
        throw new ConflictError("Content collection already exists");
      }
      updateData.slug = slug.trim();
    }

    if ("displayName" in data) {
      if (typeof displayName !== "string" || !displayName.trim()) {
        throw new ValidationError("'displayName' must be a non-empty string");
      }
    }

    return { ...updateData };
  }

  async update(id: string, data: UpdateContentCollectionData): Promise<ContentCollection> {
    validateObjectId(id);
    const contentCollection = await this.getById(id);
    const userId = getCurrentUserId(this.context);
    if (!contentCollection) {
      throw new NotFoundError("ContentCollection not found");
    }
    if (!contentCollection.createdBy.equals(userId)) {
      throw new ForbiddenError("You cannot access to this resources");
    }
    const filteredUpdateData = filterFields(data, ContentCollectionService.ALLOWED_UPDATE_FIELDS);
    const validatedData = await this.updateValidation(contentCollection, filteredUpdateData);
    const updatingFields: Partial<ContentCollection> = {
      ...validatedData,
    };
    const updatedContentCollection = await this.collection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: updatingFields, $currentDate: { updatedAt: true } },
      { returnDocument: "after" },
    );
    if (!updatedContentCollection) {
      throw new NotFoundError("failed to update contentCollection");
    }

    return updatedContentCollection;
  }

  async updateAttributeCount(id: ObjectId): Promise<ContentCollection> {
    const result = await this.collection.findOneAndUpdate(
      { _id: id },
      [
        {
          $set: {
            attributeCount: {
              $size: {
                $objectToArray: { $ifNull: ["$schema.properties", {}] },
              },
            },
            updatedAt: "$$NOW",
          },
        },
      ],
      { returnDocument: "after" },
    );

    if (!result) {
      throw new NotFoundError("Content collection not found or failed to update");
    }

    return result;
  }

  async delete(contentCollection: ContentCollection): Promise<{
    status: "success" | "failed";
    data: any;
  }> {
    const existingContents = await this.contentService.findMany({ contentCollectionId: contentCollection._id });
    if (existingContents.length > 0) {
      return { status: "failed", data: existingContents };
    }
    await Promise.all([
      this.attributeService.getCollection().deleteMany({ contentCollectionId: contentCollection._id }),
      this.collection.findOneAndDelete({ _id: contentCollection._id }),
    ]);
    return { status: "success", data: contentCollection };
  }

  async buildSchema(contentCollection: ContentCollection): Promise<ContentCollection> {
    const attributes = await this.attributeService.findMany({ contentCollectionId: contentCollection._id }, { sort: { position: 1 } });

    const schema = {
      type: "object",
      properties: {},
      required: [] as string[],
      additionalProperties: false,
    };

    for (const attribute of attributes) {
      const prop: any = {
        type: attribute.attributeType,
      };

      if (attribute.attributeKind === AttributeKindEnum.PRIMITIVE) {
        if (attribute.attributeFormat) prop.format = attribute.attributeFormat;
        if (attribute.enumValues) prop.enum = attribute.enumValues;
        if (attribute.defaultValue !== undefined && attribute.attributeType !== undefined) {
          prop.default = castPrimitive(attribute.defaultValue, attribute.attributeType);
        }

        if (attribute.validation) {
          Object.assign(prop, attribute.validation);
        }

        prop.localizable = attribute.localizable;
      } else if (attribute.attributeKind === AttributeKindEnum.COMPONENT) {
        if (!attribute.componentRefId) {
          throw new ValidationError("componentRefId is required for component attribute");
        }
        prop.componentRefId = attribute.componentRefId;
      }

      if (attribute.required) {
        schema.required.push(attribute.key);
      }

      schema.properties[attribute.key] = prop;
    }

    const updated = await this.collection.findOneAndUpdate(
      { _id: contentCollection._id },
      { $set: { schema, updatedAt: new Date() } },
      { returnDocument: "after" },
    );

    if (!updated) {
      throw new Error("Update schema into content collection failed");
    }

    return updated;
  }
}

export default ContentCollectionService;
