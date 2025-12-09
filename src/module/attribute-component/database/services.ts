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
import { Attribute, AttributeFormatEnum, AttributeKindEnum, AttributeTypeEnum, CreatePrimitiveAttributeDTO } from "../../attribute/database/models";
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
    const { key, label, category, repeatable } = data;
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

  private async addAttributeValidation(
    data: CreatePrimitiveAttributeDTO,
    attributeComponent: AttributeComponent,
  ): Promise<CreatePrimitiveAttributeDTO> {
    // --- SANITIZATION ---
    if (typeof data.key === "string") {
      data.key = data.key.trim();
    }
    if (!/^[A-Za-z0-9]+$/.test(data.key)) {
      throw new ValidationError("key may only contain letters and numbers (no spaces or symbols)");
    }
    const { key, label, required, attributeType, localizable, attributeFormat, defaultValue, enumValues, validation } = data;
    // --- VALIDATION ---
    if (!("key" in data)) {
      throw new ValidationError('"key" field is required');
    }
    if (!("label" in data)) {
      throw new ValidationError('"label" field is required');
    }
    if (!("required" in data)) {
      throw new ValidationError('"required" field is required');
    }
    if (!("attributeType" in data)) {
      throw new ValidationError('"attributeType" field is required');
    }
    if (!("localizable" in data)) {
      throw new ValidationError('"localizable" field is required');
    }

    if (typeof key !== "string" || !key.trim()) {
      throw new ValidationError("key must be a non-empty string");
    }

    const existKey = await this.attributeService.findOne({
      componentRefId: attributeComponent._id,
      key,
    });
    if (existKey) {
      throw new ValidationError("key already exists in this component");
    }

    if (typeof label !== "string" || !label.trim()) {
      throw new ValidationError("label must be a non-empty string");
    }

    if (typeof required !== "boolean") {
      throw new ValidationError("required must be a boolean");
    }

    if (!Object.values(AttributeTypeEnum).includes(attributeType)) {
      throw new ValidationError(`Attribute attributeType must be one of: ${Object.values(AttributeTypeEnum).join(", ")}`);
    }

    if (typeof localizable !== "boolean") {
      throw new ValidationError("localizable must be a boolean");
    }

    if (attributeFormat !== undefined && !Object.values(AttributeFormatEnum).includes(attributeFormat)) {
      throw new ValidationError(`Format type must be one of: ${Object.values(AttributeFormatEnum).join(", ")}`);
    }

    if (defaultValue !== undefined) {
      this.attributeService.validateDefaultValue(attributeType, defaultValue);
    }

    if (enumValues !== undefined) {
      this.attributeService.validateEnumValue(enumValues);
    }

    if (validation !== undefined) {
      this.attributeService.validateAttributeValidation(attributeType, validation, attributeFormat);
    }

    return data; // key is returned trimmed
  }

  async addAttributeInComponent(data: CreatePrimitiveAttributeDTO, attributeComponent: AttributeComponent): Promise<AttributeComponent> {
    const validatedData = await this.addAttributeValidation(data, attributeComponent);
    const createdBy = getCurrentUserId(this.context);

    const initialPath = validatedData.key;

    console.log("adding primitive attribute into the component: ", validatedData);
    const newAttribute: Attribute = {
      _id: new ObjectId(),
      key: validatedData.key,
      path: initialPath,
      label: validatedData.label,
      attributeKind: AttributeKindEnum.COMPONENT_PRIMITIVE,
      componentRefId: attributeComponent._id,
      attributeType: validatedData.attributeType,
      attributeFormat: validatedData.attributeFormat,
      required: validatedData.required,
      defaultValue: validatedData.defaultValue,
      enumValues: validatedData.enumValues,
      validation: validatedData.validation,
      localizable: validatedData.localizable,
      position: attributeComponent.attributes.length,
      createdBy,
      createdAt: new Date(),
      updatedAt: null,
    };

    await this.attributeService.getCollection().insertOne(newAttribute);
    const updatedComponent = await this.collection.findOneAndUpdate(
      { _id: attributeComponent._id },
      { $push: { attributes: newAttribute._id } },
      { returnDocument: "after" },
    );
    if (!updatedComponent) {
      throw new Error("Failed to add attribute to component");
    }

    const componentPlaceholders = await this.attributeService.findMany({
      componentRefId: attributeComponent._id,
      attributeKind: AttributeKindEnum.COMPONENT,
    });

    const updatePromises: Promise<any>[] = [];

    for (const placeholder of componentPlaceholders) {
      const newBasePath = placeholder.path;

      const allNestedPathUpdates = await this.attributeService.buildPathsRecursively(placeholder, newBasePath);

      const batchUpdates = allNestedPathUpdates.map((update) => {
        return this.attributeService.getCollection().findOneAndUpdate({ _id: update.id }, { $set: { path: update.path } });
      });
      updatePromises.push(...batchUpdates);
    }

    await Promise.all(updatePromises);

    await this.buildSchemaForComponent(updatedComponent);

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

  async buildSchemaForComponent(attributeComponent: AttributeComponent): Promise<any> {
    const isRepeatable = attributeComponent.repeatable;

    let schema: any;
    let targetSchema: any;

    if (isRepeatable) {
      schema = {
        type: "array",
        items: {
          type: "object",
          properties: {},
          required: [] as string[],
          additionalProperties: false,
        },
      };
      targetSchema = schema.items;
    } else {
      schema = {
        type: "object",
        properties: {},
        required: [] as string[],
        additionalProperties: false,
      };
      targetSchema = schema;
    }

    const attributes = await this.attributeService.findMany(
      {
        _id: { $in: attributeComponent.attributes },
      },
      { sort: { position: 1 } },
    );

    for (const attribute of attributes) {
      if (attribute.attributeKind !== AttributeKindEnum.PRIMITIVE && attribute.attributeKind !== AttributeKindEnum.COMPONENT_PRIMITIVE) {
        throw new Error(`Component schema cannot contain non-primitive attribute kind: ${attribute.attributeKind} for key: ${attribute.key}`);
      }

      if (!attribute.attributeType) {
        console.warn(`Skipping attribute ${attribute.key}: Missing attributeType.`);
        continue;
      }

      const property: any = {
        type: attribute.attributeType,
      };

      // Add standard primitive properties
      if (attribute.attributeFormat) property.format = attribute.attributeFormat;
      if (attribute.enumValues?.length) property.enum = attribute.enumValues;
      if (attribute.defaultValue !== undefined) property.default = attribute.defaultValue;

      property.localizable = attribute.localizable;

      // Apply validation rules
      if (attribute.validation) {
        Object.assign(property, attribute.validation);
      }

      targetSchema.properties[attribute.key] = property;

      if (attribute.required) {
        targetSchema.required.push(attribute.key);
      }
    }

    const updated = await this.collection.findOneAndUpdate(
      { _id: attributeComponent._id },
      { $set: { schema, updatedAt: new Date() } },
      { returnDocument: "after" },
    );

    if (!updated) {
      throw new Error("Update schema into component failed");
    }

    return updated;
  }
}

export default AttributeComponentService;
