import { ObjectId, Db, Collection, FindOptions, Filter } from "mongodb";
import { getCurrentUserId } from "../../../utils/helper.auth";
import { validateObjectId } from "../../../utils/helper.mongo";
import { NotFoundError, ValidationError } from "../../../utils/helper.errors";
import { WithMetaData } from "../../../utils/helper";
import { QueryOptions, findWithOptions } from "../../../utils/helper";
import { AppContext } from "../../../utils/helper.context";
import { BaseService } from "../../core/base-service";
import { AttributeComponent, CreateAttributeComponentDto } from "./models";
import AttributeService from "../../attribute/database/services";
import { Tenant } from "../../tenant/database/models";
import { Attribute, AttributeKindEnum, CreatePrimitiveAttributeDTO } from "../../attribute/database/models";
import { ContentCollection } from "../../content-collection/database/models";

class AttributeComponentService extends BaseService {
  private db: Db;
  private collection: Collection<AttributeComponent>;
  public readonly collectionName = "attribute-components";
  private attributeService: AttributeService;

  constructor(context: AppContext) {
    super(context);
    this.db = context.mongoDatabase;
    this.collection = this.db.collection<AttributeComponent>(this.collectionName);
  }

  async init() {
    this.attributeService = this.getService("AttributeService");
  }

  private async createValidation(data: CreateAttributeComponentDto, tenant: Tenant): Promise<CreateAttributeComponentDto> {
    // --- SANITIZATION ---
    if (typeof data.key === "string") {
      data.key = data.key.trim();
    }
    if (typeof data.category === "string") {
      data.category = data.category.trim();
    }
    if (!/^[A-Za-z0-9]+$/.test(data.key)) {
      throw new ValidationError("key may only contain letters and numbers (no spaces or symbols)");
    }
    if (!/^[A-Za-z0-9]+$/.test(data.category)) {
      throw new ValidationError("category may only contain letters and numbers (no spaces or symbols)");
    }
    const { key, label, category, repeatable, localizable } = data;
    if (!("key" in data)) {
      throw new ValidationError('"key" field is required');
    }
    if (!("label" in data)) {
      throw new ValidationError('"label" field is required');
    }
    if (!("category" in data)) {
      throw new ValidationError('"category" field is required');
    }
    if (!("repeatable" in data)) {
      throw new ValidationError('"repeatable" field is required');
    }
    if (typeof key !== "string" || !key.trim()) {
      throw new ValidationError("key must be a non-empty string");
    }
    if (typeof label !== "string" || !label.trim()) {
      throw new ValidationError("label must be a non-empty string");
    }
    if (typeof category !== "string" || !category.trim()) {
      throw new ValidationError("category must be a non-empty string");
    }
    if (typeof repeatable !== "boolean") {
      throw new ValidationError("repeatable must be a boolean");
    }
    if (typeof localizable !== "boolean") {
      throw new ValidationError("localizable must be a boolean");
    }
    const existedKey = await this.collection.findOne({ tenantId: tenant._id, category, key });
    if (existedKey) {
      throw new ValidationError("key already exist");
    }
    return data;
  }

  async create(data: CreateAttributeComponentDto, tenant: Tenant): Promise<AttributeComponent> {
    const validatedData = await this.createValidation(data, tenant);
    const createdBy = getCurrentUserId(this.context);

    console.log("Creating attribute component: ", validatedData);
    const newAttributeComponent: AttributeComponent = {
      _id: new ObjectId(),
      tenantId: tenant._id,
      key: validatedData.key,
      label: validatedData.label,
      category: validatedData.category,
      schema: {},
      attributes: [],
      repeatable: validatedData.repeatable,
      localizable: validatedData.localizable,
      createdBy,
      createdAt: new Date(),
      updatedAt: null,
    };
    const result = await this.collection.insertOne(newAttributeComponent);
    if (!result) {
      throw new NotFoundError("Failed to create the attribute component");
    }
    return newAttributeComponent;
  }

  async addAttribute(attributeDto: CreatePrimitiveAttributeDTO, attributeComponent: AttributeComponent): Promise<AttributeComponent> {
    const newAttribute = await this.attributeService.addAttributeInComponent(attributeDto, attributeComponent);
    const updatedComponent = await this.collection.findOneAndUpdate(
      { _id: attributeComponent._id },
      { $push: { attributes: newAttribute._id } },
      { returnDocument: "after" }, // returns the updated document
    );
    if (!updatedComponent) {
      throw new Error("Failed to add attribute to component");
    }
    await this.addSchema(attributeComponent._id, newAttribute);
    return updatedComponent;
  }

  async getAll(queryOptions: QueryOptions): Promise<WithMetaData<AttributeComponent>> {
    const options = {
      ...queryOptions,
      filter: {
        ...(queryOptions.filter || {}),
      },
    };
    return await findWithOptions(this.collection, options);
  }

  async getById(id: string): Promise<AttributeComponent | null> {
    validateObjectId(id);
    return await this.collection.findOne({ _id: new ObjectId(id) });
  }

  async findOne(filter: Partial<AttributeComponent>, options?: FindOptions<AttributeComponent>): Promise<AttributeComponent | null> {
    return await this.collection.findOne(filter, options);
  }

  async findMany(filter: Filter<AttributeComponent>, options?: FindOptions<AttributeComponent>): Promise<AttributeComponent[]> {
    return this.collection.find(filter, options).toArray();
  }

  async addSchema(id: ObjectId, attribute: Attribute): Promise<AttributeComponent> {
    const attributeComponent = await this.findOne({ _id: id });
    if (!attributeComponent) {
      throw new NotFoundError("Attribute component not found");
    }
    const isRepeatable = attributeComponent.repeatable;
    let schema = attributeComponent.schema;
    if (!schema) {
      if (isRepeatable) {
        schema = {
          type: "array",
          items: {
            type: "object",
            properties: {},
            required: [],
            additionalProperties: false,
          },
        };
      } else {
        schema = {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        };
      }
    }
    let targetSchema;

    if (isRepeatable) {
      schema.type = "array";

      schema.items ??= {};
      schema.items.type = "object";
      schema.items.properties ??= {};
      schema.items.required ??= [];
      if (schema.items.additionalProperties === undefined) schema.items.additionalProperties = false;

      targetSchema = schema.items;
    } else {
      schema.type = "object";

      schema.properties ??= {};
      schema.required ??= [];
      if (schema.additionalProperties === undefined) schema.additionalProperties = false;

      targetSchema = schema;
    }

    if (attribute.attributeKind !== AttributeKindEnum.PRIMITIVE) {
      throw new ValidationError("You can only add primitive attributes to a component");
    }

    const property: any = {
      type: attribute.attributeType?.toLowerCase(),
    };

    if (attribute.attributeFormat) {
      property.format = attribute.attributeFormat;
    }

    if (attribute.validation) {
      const v = attribute.validation;
      if (v.minLength !== undefined) property.minLength = v.minLength;
      if (v.maxLength !== undefined) property.maxLength = v.maxLength;
      if (v.minimum !== undefined) property.minimum = v.minimum;
      if (v.maximum !== undefined) property.maximum = v.maximum;
      if (v.pattern !== undefined) property.pattern = v.pattern;
    }

    if (attribute.enumValues?.length) {
      property.enum = attribute.enumValues;
    }

    if (attribute.defaultValue !== undefined) {
      property.default = attribute.defaultValue;
    }

    if (attributeComponent.localizable) {
      property.localizable = attribute.localizable;
    }

    targetSchema.properties[attribute.key] = property;

    if (attribute.required && !targetSchema.required.includes(attribute.key)) {
      targetSchema.required.push(attribute.key);
    }

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

    if (!updated) {
      throw new Error("Failed to update attribute component schema");
    }

    return updated;
  }
}

export default AttributeComponentService;
