import { ObjectId, Db, Collection, FindOptions } from "mongodb";
import { getCurrentOrganizationId, getCurrentUserId } from "../../../utils/helper.auth";
import { validateObjectId } from "../../../utils/helper.mongo";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../../utils/helper.errors";
import { filterFields, WithMetaData } from "../../../utils/helper";
import { QueryOptions, findWithOptions } from "../../../utils/helper";
import { AppContext } from "../../../utils/helper.context";
import OrganizationService from "../../organization/database/services";
import { ContentCollection, CreateContentCollectionData, UpdateContentCollectionData } from "./models";
import TenantService from "../../tenant/database/services";
import { Attribute, UpdateAttributeData } from "../../attribute/database/models";
import { BaseService } from "../../core/base-service";
import AttributeService from "../../attribute/database/services";

class ContentCollectionService extends BaseService {
  private db: Db;
  private collection: Collection<ContentCollection>;
  public readonly collectionName = "content-collections";
  private static readonly ALLOWED_UPDATE_FIELDS: ReadonlySet<keyof UpdateContentCollectionData> = new Set(["name", "displayName"] as const);
  private tenantService: TenantService;
  private attributeService: AttributeService;

  constructor(context: AppContext) {
    super(context);
    this.db = context.mongoDatabase;
    this.collection = this.db.collection<ContentCollection>(this.collectionName);
  }

  async init() {
    this.tenantService = this.getService("TenantService");
    this.attributeService = this.getService("AttributeService");
  }

  private async createValidation(organizationId: ObjectId, data: CreateContentCollectionData): Promise<CreateContentCollectionData> {
    const { tenantId, name, displayName } = data;
    if (!("tenantId" in data)) {
      throw new ValidationError('"tenantId" field is required');
    }
    if (!("name" in data)) {
      throw new ValidationError('"name" field is required');
    }
    if (!("displayName" in data)) {
      throw new ValidationError('"displayName" field is required');
    }
    if (typeof name !== "string" || !name.trim()) {
      throw new ValidationError("name must be a non-empty string");
    }
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/i.test(name)) {
      throw new ValidationError("Name can only contain letters, numbers, and single hyphens (no spaces)");
    }
    if (typeof displayName !== "string" || !displayName.trim()) {
      throw new ValidationError("displayName must be a non-empty string");
    }
    validateObjectId(tenantId);
    const tenant = await this.tenantService.getById(tenantId.toString());
    if (!tenant) {
      throw new NotFoundError("Tenant not found");
    }
    if (!tenant.organizationId.equals(organizationId)) {
      throw new ForbiddenError("Not authorized to create this content collection");
    }
    return data;
  }

  async create(data: ContentCollection): Promise<ContentCollection> {
    const organizationId = getCurrentOrganizationId(this.context);
    if (!organizationId) {
      throw new ValidationError('"organizationId" field is required');
    }
    const { tenantId, name, displayName } = await this.createValidation(organizationId, data);
    const createdBy = getCurrentUserId(this.context);

    console.log("Creating :", name);
    const newContentCollection: ContentCollection = {
      organizationId,
      tenantId,
      name: name.trim(),
      displayName: displayName.trim(),
      schema: null,
      attributeCount: 0,
      createdAt: new Date(),
      createdBy,
    };

    const result = await this.collection.insertOne(newContentCollection);
    return { _id: result.insertedId, ...newContentCollection };
  }

  async getAll(queryOptions: QueryOptions): Promise<WithMetaData<ContentCollection>> {
    const options = {
      ...queryOptions,
      filter: {
        ...(queryOptions.filter || {}),
      },
    };
    return await findWithOptions(this.collection, options);
  }

  async getById(id: string): Promise<ContentCollection | null> {
    validateObjectId(id);
    return await this.collection.findOne({ _id: new ObjectId(id) });
  }

  async findOne(filter: Partial<ContentCollection>, options?: FindOptions<ContentCollection>): Promise<ContentCollection | null> {
    return await this.collection.findOne(filter, options);
  }

  private async updateValidation(contentCollection: ContentCollection, data: UpdateContentCollectionData): Promise<UpdateContentCollectionData> {
    const { name, displayName } = data;
    let updateData: UpdateContentCollectionData = { ...data };

    if (!("name" in data) && !("displayName" in data)) {
      throw new BadRequestError("No valid fields provided for update");
    }

    if ("name" in data) {
      if (typeof name !== "string" || !name.trim()) {
        throw new ValidationError("name must be a non-empty string");
      }
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/i.test(name)) {
        throw new ValidationError("Name can only contain letters, numbers, and single hyphens (no spaces)");
      }
      const existingContentCollection = await this.collection.findOne({
        organizationId: contentCollection.organizationId,
        name: name.trim(),
      });
      if (existingContentCollection) {
        throw new ConflictError("name already exists");
      }
      updateData.name = name.trim();
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
    const organizationId = getCurrentOrganizationId(this.context);
    if (!organizationId) {
      throw new ValidationError('"organizationId" field is required');
    }
    const contentCollection = await this.getById(id);
    if (!contentCollection) {
      throw new NotFoundError("ContentCollection not found");
    }
    if (!contentCollection.organizationId.equals(organizationId)) {
      throw new ForbiddenError("You are not allow to edit this content collection");
    }
    const filteredUpdateData = filterFields(data, ContentCollectionService.ALLOWED_UPDATE_FIELDS);
    const validatedData = await this.updateValidation(contentCollection, filteredUpdateData);
    const updatingFields: Partial<ContentCollection> = {
      ...validatedData,
    };
    const updatedContentCollection = await this.collection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: updatingFields, $currentDate: { updatedAt: true } },
      { returnDocument: "after" }
    );
    if (!updatedContentCollection) {
      throw new NotFoundError("failed to update contentCollection");
    }

    return updatedContentCollection;
  }

  async addSchema(id: string, attribute: Attribute): Promise<ContentCollection> {
    const contentCollection = await this.getById(id);
    if (!contentCollection) {
      throw new NotFoundError("Content collection not found");
    }

    const schema = contentCollection.schema ?? {};
    if (schema.type !== "object") schema.type = "object";
    if (!schema.properties) schema.properties = {};
    if (!schema.required) schema.required = [];
    if (schema.additionalProperties === undefined) schema.additionalProperties = false;

    // Build AJV property from attribute
    const property: any = { type: attribute.type.toLowerCase() };
    if (attribute.format) {
      property.format = attribute.format;
    }
    if (attribute.validation) {
      if (attribute.validation.minLength !== undefined) property.minLength = attribute.validation.minLength;
      if (attribute.validation.maxLength !== undefined) property.maxLength = attribute.validation.maxLength;
      if (attribute.validation.minimum !== undefined) property.minimum = attribute.validation.minimum;
      if (attribute.validation.maximum !== undefined) property.maximum = attribute.validation.maximum;
      if (attribute.validation.pattern !== undefined) property.pattern = attribute.validation.pattern;
    }
    if (attribute.enumValues && attribute.enumValues.length > 0) {
      property.enum = attribute.enumValues;
    }
    if (attribute.defaultValue !== undefined) {
      property.default = attribute.defaultValue;
    }
    // Add property to schema, update the schema if already exists
    schema.properties[attribute.key] = property;
    // handling the required field in AJV
    if (attribute.required && !schema.required.includes(attribute.key)) {
      schema.required.push(attribute.key);
    }
    const updated = await this.collection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      {
        $set: {
          schema,
          updatedAt: new Date(),
        },
      },
      { returnDocument: "after" }
    );
    if (!updated) {
      throw new Error("Failed to update content collection schema");
    }
    return updated;
  }

  async updateSchema(oldAttribute: Attribute, attribute: UpdateAttributeData): Promise<ContentCollection> {
    const contentCollection = await this.getById(oldAttribute.contentCollectionId.toString());
    if (!contentCollection) throw new NotFoundError("Content collection not found");

    const schema = contentCollection.schema || { type: "object", properties: {}, required: [], additionalProperties: false };

    const property: any = {
      type: oldAttribute.type.toLowerCase(),
    };

    if (attribute.format) property.format = attribute.format;
    if (attribute.validation) {
      if (attribute.validation.minLength !== undefined) property.minLength = attribute.validation.minLength;
      if (attribute.validation.maxLength !== undefined) property.maxLength = attribute.validation.maxLength;
      if (attribute.validation.minimum !== undefined) property.minimum = attribute.validation.minimum;
      if (attribute.validation.maximum !== undefined) property.maximum = attribute.validation.maximum;
      if (attribute.validation.pattern !== undefined) property.pattern = attribute.validation.pattern;
    }
    if (attribute.enumValues && attribute.enumValues.length > 0) property.enum = attribute.enumValues;
    if (attribute.defaultValue !== undefined) property.default = attribute.defaultValue;

    schema.properties[oldAttribute.key] = property;

    const requiredSet = new Set(schema.required || []);
    if (attribute.required) {
      requiredSet.add(oldAttribute.key);
    } else {
      requiredSet.delete(oldAttribute.key);
    }
    schema.required = Array.from(requiredSet);

    const updated = await this.collection.findOneAndUpdate(
      { _id: new ObjectId(oldAttribute.contentCollectionId) },
      { $set: { schema, updatedAt: new Date() } },
      { returnDocument: "after" }
    );

    if (!updated) throw new Error("Failed to update content collection schema");

    return updated;
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
      { returnDocument: "after" }
    );

    if (!result) {
      throw new NotFoundError("Content collection not found or failed to update");
    }

    return result;
  }

  private async deleteValidation(id: string) {
    const contentCollection = await this.collection.findOne({ _id: new ObjectId(id) }, { projection: { name: 1 } });
    const attributes = await this.attributeService.getAll({
      filter: { _id: new ObjectId(id) },
    });
    if (attributes.data.length >= 1) {
    }
  }

  async delete(id: string): Promise<void> {
    await this.deleteValidation(id);
    await this.collection.deleteOne({ _id: new ObjectId(id) });
  }
}

export default ContentCollectionService;
