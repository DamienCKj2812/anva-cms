import { ObjectId, Db, Collection, FindOptions, Filter, Document } from "mongodb";
import { getCurrentUserId } from "../../../utils/helper.auth";
import { validateObjectId } from "../../../utils/helper.mongo";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../../utils/helper.errors";
import { filterFields, WithMetaData } from "../../../utils/helper";
import { AppContext } from "../../../utils/helper.context";
import {
  ContentCollection,
  ContentCollectionTypeEnum,
  CreateContentCollectionData,
  DeleteContentCollectionResponse,
  UpdateContentCollectionData,
} from "./models";
import TenantService from "../../tenant/database/services";
import { Attribute, AttributeKindEnum } from "../../attribute/database/models";
import { BaseService } from "../../core/base-service";
import AttributeService from "../../attribute/database/services";
import ContentService from "../../content/database/services";
import AttributeComponentService from "../../attribute-component/database/services";
import { ContentStatusEnum } from "../../content/database/models";

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

  private async deleteValidation(id: string): Promise<{ contentCollection: ContentCollection; nonDeletedAttributes: WithMetaData<Attribute> }> {
    const contentCollection = await this.collection.findOne({ _id: new ObjectId(id) });
    const userId = getCurrentUserId(this.context);
    if (!contentCollection) {
      throw new NotFoundError("content collection not found");
    }
    if (!contentCollection.createdBy.equals(userId)) {
      throw new ForbiddenError("You are not allowed to access this resources");
    }
    const attributes = await this.attributeService.getAll({
      filter: { contentCollectionId: new ObjectId(id) },
      projection: { _id: 1, key: 1, label: 1 },
    });
    return {
      contentCollection,
      nonDeletedAttributes: attributes,
    };
  }

  async delete(id: string): Promise<DeleteContentCollectionResponse> {
    const { contentCollection, nonDeletedAttributes } = await this.deleteValidation(id);
    if (nonDeletedAttributes.data.length > 0) {
      return { status: "failed", data: nonDeletedAttributes };
    }
    await this.collection.deleteOne({ _id: new ObjectId(id) });
    return { status: "success", data: contentCollection };
  }

  async addSchema(id: string, attribute: Attribute): Promise<ContentCollection> {
    const contentCollection = await this.getById(id);
    if (!contentCollection) {
      throw new NotFoundError("Content collection not found");
    }

    // Base schema
    const schema = contentCollection.schema ?? {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    };

    // Ensure base structure
    schema.type = "object";
    schema.properties ||= {};
    schema.required ||= [];
    if (schema.additionalProperties === undefined) {
      schema.additionalProperties = false;
    }

    let property: any = null;

    // PRIMITIVE ATTRIBUTE
    if (attribute.attributeKind === AttributeKindEnum.PRIMITIVE) {
      property = { type: attribute.attributeType?.toLowerCase() };

      if (attribute.attributeFormat) property.format = attribute.attributeFormat;

      if (attribute.validation) {
        const v = attribute.validation;
        if (v.minLength !== undefined) property.minLength = v.minLength;
        if (v.maxLength !== undefined) property.maxLength = v.maxLength;
        if (v.minimum !== undefined) property.minimum = v.minimum;
        if (v.maximum !== undefined) property.maximum = v.maximum;
        if (v.pattern !== undefined) property.pattern = v.pattern;
      }

      if (attribute.enumValues?.length) property.enum = attribute.enumValues;
      if (attribute.defaultValue !== undefined) property.default = attribute.defaultValue;

      // Add localizable flag
      property.localizable = attribute.localizable;
    }

    // COMPONENT ATTRIBUTE
    else if (attribute.attributeKind === AttributeKindEnum.COMPONENT) {
      if (!attribute.componentRefId) {
        throw new ValidationError("componentRefId is required for component attribute");
      }

      const component = await this.attributeComponentService.findOne({ _id: attribute.componentRefId });
      if (!component) {
        throw new NotFoundError("Component not found");
      }

      // POINTER ONLY — DO NOT RESOLVE SCHEMA HERE
      property = {
        type: "component",
        componentRefId: attribute.componentRefId,
        repeatable: component.repeatable,
        localizable: component.localizable, // mark component-level localization
      };
    }

    // Assign property to schema
    schema.properties[attribute.key] = property;

    // Add to required if needed
    if (attribute.required && !schema.required.includes(attribute.key)) {
      schema.required.push(attribute.key);
    }

    // Update the content collection
    const updated = await this.collection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      {
        $set: {
          schema,
          updatedAt: new Date(),
        },
      },
      { returnDocument: "after" },
    );

    if (!updated) throw new Error("Failed to update content collection schema");

    return updated;
  }

  async updateSchema(oldAttribute: Attribute, attribute: Attribute): Promise<ContentCollection> {
    const contentCollection = await this.getById(oldAttribute.contentCollectionId?.toString() || "");
    if (!contentCollection) throw new NotFoundError("Content collection not found");

    const schema = contentCollection.schema ?? {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    };

    schema.type = "object";
    schema.properties ||= {};
    schema.required ||= [];
    if (schema.additionalProperties === undefined) schema.additionalProperties = false;

    let property: any;

    switch (attribute.attributeKind) {
      case AttributeKindEnum.PRIMITIVE:
        property = { type: attribute.attributeType?.toLowerCase() };

        if (attribute.attributeFormat) property.format = attribute.attributeFormat;

        if (attribute.validation) {
          const v = attribute.validation;
          if (v.minLength !== undefined) property.minLength = v.minLength;
          if (v.maxLength !== undefined) property.maxLength = v.maxLength;
          if (v.minimum !== undefined) property.minimum = v.minimum;
          if (v.maximum !== undefined) property.maximum = v.maximum;
          if (v.pattern !== undefined) property.pattern = v.pattern;
        }

        if (attribute.enumValues?.length) property.enum = attribute.enumValues;
        if (attribute.defaultValue !== undefined) property.default = attribute.defaultValue;

        // Add localizable flag
        property.localizable = attribute.localizable;
        break;

      case AttributeKindEnum.COMPONENT:
        if (!attribute.componentRefId) throw new ValidationError("componentRefId is required for component attribute");

        const component = await this.attributeComponentService.findOne({ _id: attribute.componentRefId });
        if (!component) throw new NotFoundError("Component not found");

        // Store only pointer
        property = {
          type: "component",
          componentRefId: attribute.componentRefId,
          repeatable: component.repeatable,
          localizable: component.localizable, // mark component-level localization
        };
        break;

      default:
        throw new ValidationError("Unsupported attribute kind");
    }

    // Update property in schema
    schema.properties[oldAttribute.key] = property;

    // Update required array
    const requiredSet = new Set(schema.required);
    if (attribute.required) requiredSet.add(oldAttribute.key);
    else requiredSet.delete(oldAttribute.key);
    schema.required = Array.from(requiredSet);

    // Save updated schema
    const updated = await this.collection.findOneAndUpdate(
      { _id: new ObjectId(oldAttribute.contentCollectionId) },
      { $set: { schema, updatedAt: new Date() } },
      { returnDocument: "after" },
    );

    if (!updated) throw new Error("Failed to update content collection schema");

    return updated;
  }

  async deleteSchema(contentCollection: ContentCollection, attributeKey: string): Promise<ContentCollection> {
    if (!contentCollection) {
      throw new NotFoundError("Content collection not found");
    }
    const schema = contentCollection.schema || {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    };
    if (!schema.properties || !schema.properties[attributeKey]) {
      throw new NotFoundError(`Attribute "${attributeKey}" not found in schema`);
    }

    delete schema.properties[attributeKey];

    // Remove from required array if exists
    if (schema.required) {
      schema.required = schema.required.filter((key: string) => key !== attributeKey);
    }

    const updated = await this.collection.findOneAndUpdate(
      { _id: new ObjectId(contentCollection._id) },
      {
        $set: {
          schema,
          updatedAt: new Date(),
        },
      },
      { returnDocument: "after" },
    );
    if (!updated) {
      throw new Error("Failed to update content collection schema after delete");
    }

    return updated;
  }
}

export default ContentCollectionService;
