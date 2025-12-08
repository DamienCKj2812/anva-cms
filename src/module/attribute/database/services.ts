import { ObjectId, Db, Collection, FindOptions, Filter } from "mongodb";
import { getCurrentUserId } from "../../../utils/helper.auth";
import { validateObjectId } from "../../../utils/helper.mongo";
import { NotFoundError, ValidationError } from "../../../utils/helper.errors";
import { filterFields, WithMetaData } from "../../../utils/helper";
import { QueryOptions, findWithOptions } from "../../../utils/helper";
import { AppContext } from "../../../utils/helper.context";
import {
  Attribute,
  AttributeFormatEnum,
  AttributeKindEnum,
  AttributeTypeEnum,
  CreateComponentAttributeDTO,
  CreatePrimitiveAttributeDTO,
  DeleteAttributeResponse,
  UpdatePrimitiveAttributeDTO,
  ValidationRules,
} from "./models";
import ContentCollectionService from "../../content-collection/database/services";
import { ContentCollection } from "../../content-collection/database/models";
import { BaseService } from "../../core/base-service";
import AttributeComponentService from "../../attribute-component/database/services";
import { AttributeComponent } from "../../attribute-component/database/models";

class AttributeService extends BaseService {
  private db: Db;
  private collection: Collection<Attribute>;
  public readonly collectionName = "attributes";
  private static readonly ALLOWED_UPDATE_FIELDS: ReadonlySet<keyof UpdatePrimitiveAttributeDTO> = new Set([
    "label",
    "required",
    "defaultValue",
    "enumValues",
    "localizable",
  ] as const);
  private contentCollectionService: ContentCollectionService;
  private attributeComponentService: AttributeComponentService;

  constructor(context: AppContext) {
    super(context);
    this.db = context.mongoDatabase;
    this.collection = this.db.collection<Attribute>(this.collectionName);
  }

  async init() {
    this.contentCollectionService = this.getService("ContentCollectionService");
    this.attributeComponentService = this.getService("AttributeComponentService");
  }

  private async createPrimitiveAttributeValidation(
    data: CreatePrimitiveAttributeDTO,
    contentCollection: ContentCollection,
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

    const existKey = await this.collection.findOne({
      contentCollectionId: contentCollection._id,
      key,
    });
    if (existKey) {
      throw new ValidationError("key already exists in this content collection");
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
      this.validateDefaultValue(attributeType, defaultValue);
    }

    if (enumValues !== undefined) {
      this.validateEnumValue(enumValues);
    }

    if (validation !== undefined) {
      this.validateAttributeValidation(attributeType, validation, attributeFormat);
    }

    return data; // key is returned trimmed
  }

  async createPrimitiveAttribute(data: CreatePrimitiveAttributeDTO, contentCollection: ContentCollection): Promise<Attribute> {
    const validatedData = await this.createPrimitiveAttributeValidation(data, contentCollection);
    const createdBy = getCurrentUserId(this.context);

    console.log("Creating primitive attribute: ", validatedData);
    const attributeCount = await this.collection.countDocuments({ contentCollectionId: contentCollection._id });
    const newAttribute: Attribute = {
      _id: new ObjectId(),
      contentCollectionId: contentCollection._id,
      key: validatedData.key,
      label: validatedData.label,
      attributeKind: AttributeKindEnum.PRIMITIVE,
      attributeType: validatedData.attributeType,
      attributeFormat: validatedData.attributeFormat,
      required: validatedData.required,
      defaultValue: validatedData.defaultValue,
      enumValues: validatedData.enumValues,
      validation: validatedData.validation,
      localizable: validatedData.localizable,
      position: attributeCount,
      createdBy,
      createdAt: new Date(),
      updatedAt: null,
    };
    const result = await this.collection.insertOne(newAttribute);
    if (!result) {
      throw new NotFoundError("Failed to create the attribute");
    }
    await this.contentCollectionService.addSchema(contentCollection._id?.toString()!, newAttribute);
    await this.contentCollectionService.updateAttributeCount(contentCollection._id!);
    return newAttribute;
  }

  private async createComponentAttributeValidation(
    data: CreateComponentAttributeDTO,
    contentCollection: ContentCollection,
  ): Promise<{ validatedData: CreateComponentAttributeDTO; attributeComponent: AttributeComponent }> {
    const { key, label, required, componentRefId } = data;
    if (!("key" in data)) {
      throw new ValidationError('"key" field is required');
    }
    if (!("label" in data)) {
      throw new ValidationError('"label" field is required');
    }
    if (!("required" in data)) {
      throw new ValidationError('"required" field is required');
    }
    if (!("componentRefId" in data)) {
      throw new ValidationError('"componentRefId" field is required');
    }
    if (typeof key !== "string" || !key.trim()) {
      throw new ValidationError("key must be a non-empty string");
    }
    const existKey = await this.collection.findOne({ contentCollectionId: contentCollection._id, key });
    if (existKey) {
      throw new ValidationError("key is already exists in this contente collection");
    }
    if (typeof label !== "string" || !label.trim()) {
      throw new ValidationError("label must be a non-empty string");
    }
    if (typeof required !== "boolean") {
      throw new ValidationError("required must be a boolean");
    }
    if (typeof componentRefId !== "string" || !componentRefId.trim()) {
      throw new ValidationError("componentRefId must be a non-empty string");
    }
    const component = await this.attributeComponentService.findOne({ _id: new ObjectId(componentRefId) });
    if (!component) {
      throw new NotFoundError("attribute component not found");
    }
    return {
      validatedData: data,
      attributeComponent: component,
    };
  }

  async createComponentAttribute(data: CreateComponentAttributeDTO, contentCollection: ContentCollection): Promise<Attribute> {
    const { validatedData, attributeComponent } = await this.createComponentAttributeValidation(data, contentCollection);
    const createdBy = getCurrentUserId(this.context);

    console.log("Creating component attribute: ", validatedData);
    const attributeCount = await this.collection.countDocuments({ contentCollectionId: contentCollection._id });

    const newAttribute: Attribute = {
      _id: new ObjectId(),
      contentCollectionId: contentCollection._id,
      key: validatedData.key,
      label: validatedData.label,
      attributeKind: AttributeKindEnum.COMPONENT,
      componentRefId: attributeComponent._id,
      required: validatedData.required,
      localizable: true,
      position: attributeCount,
      createdBy,
      createdAt: new Date(),
      updatedAt: null,
    };
    const result = await this.collection.insertOne(newAttribute);
    if (!result) {
      throw new NotFoundError("Failed to create the component attribute");
    }
    await this.contentCollectionService.addSchema(contentCollection._id?.toString()!, newAttribute);
    await this.contentCollectionService.updateAttributeCount(contentCollection._id!);
    return newAttribute;
  }

  private async addAttributeInComponentValidation(
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

    const existKey = await this.collection.findOne({
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
      this.validateDefaultValue(attributeType, defaultValue);
    }

    if (enumValues !== undefined) {
      this.validateEnumValue(enumValues);
    }

    if (validation !== undefined) {
      this.validateAttributeValidation(attributeType, validation, attributeFormat);
    }

    return data; // key is returned trimmed
  }

  async addAttributeInComponent(data: CreatePrimitiveAttributeDTO, attributeComponent: AttributeComponent): Promise<Attribute> {
    const validatedData = await this.addAttributeInComponentValidation(data, attributeComponent);
    const createdBy = getCurrentUserId(this.context);

    console.log("adding primitive attribute into the component: ", validatedData);
    const newAttribute: Attribute = {
      _id: new ObjectId(),
      key: validatedData.key,
      label: validatedData.label,
      attributeKind: AttributeKindEnum.PRIMITIVE,
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
    const result = await this.collection.insertOne(newAttribute);
    if (!result) {
      throw new NotFoundError("Failed to create the attribute");
    }
    return newAttribute;
  }

  async getAll(queryOptions: QueryOptions): Promise<WithMetaData<Attribute>> {
    const options = {
      ...queryOptions,
      filter: {
        ...(queryOptions.filter || {}),
      },
    };
    return await findWithOptions(this.collection, options);
  }

  async getById(id: string): Promise<Attribute | null> {
    validateObjectId(id);
    return await this.collection.findOne({ _id: new ObjectId(id) });
  }

  async findOne(filter: Partial<Attribute>, options?: FindOptions<Attribute>): Promise<Attribute | null> {
    return await this.collection.findOne(filter, options);
  }

  async findMany(filter: Filter<Attribute>, options?: FindOptions<Attribute>): Promise<Attribute[]> {
    return this.collection.find(filter, options).toArray();
  }

  private async updateValidation(attribute: Attribute, data: UpdatePrimitiveAttributeDTO): Promise<UpdatePrimitiveAttributeDTO> {
    const { label, required, localizable, defaultValue, enumValues } = data;
    if (!("label" in data) && !("required" in data) && !("defaultValue" in data) && !("enumValues" in data) && !("validation" in data)) {
      throw new NotFoundError("No valid fields provided for update");
    }
    if (label && (typeof label !== "string" || !label.trim())) {
      throw new ValidationError("label must be a non-empty string");
    }
    if (required && typeof required !== "boolean") {
      throw new ValidationError("required must be a boolean");
    }
    if (localizable && typeof localizable !== "boolean") {
      throw new ValidationError("localizable must be a boolean");
    }
    if (defaultValue !== undefined) {
      switch (attribute.attributeType) {
        case AttributeTypeEnum.STRING:
          if (typeof defaultValue !== "string" || !defaultValue.trim()) {
            throw new ValidationError("defaultValue must be a non-empty string");
          }
          break;
        case AttributeTypeEnum.NUMBER:
          if (typeof defaultValue !== "number") {
            throw new ValidationError("defaultValue must be a number");
          }
          break;
        case AttributeTypeEnum.BOOLEAN:
          if (typeof defaultValue !== "boolean") {
            throw new ValidationError("defaultValue must be a boolean");
          }
          break;
      }
    }
    if (enumValues !== undefined) {
      if (!Array.isArray(enumValues) || enumValues.length === 0) {
        throw new ValidationError("enumValues must be a non-empty array of strings");
      }
      if (enumValues.some((v) => typeof v !== "string" || !v.trim())) {
        throw new ValidationError("enumValues must contain only non-empty strings");
      }
    }
    return data;
  }

  async update(id: string, data: UpdatePrimitiveAttributeDTO): Promise<Attribute> {
    validateObjectId(id);
    const attribute = await this.getById(id);
    if (!attribute) {
      throw new NotFoundError("attribute not found");
    }
    const filteredUpdateData = filterFields(data, AttributeService.ALLOWED_UPDATE_FIELDS);
    const validatedData = await this.updateValidation(attribute, filteredUpdateData);
    const updatingFields: Partial<Attribute> = {
      ...validatedData,
    };
    const updatedAttribute = await this.collection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: updatingFields, $currentDate: { updatedAt: true } },
      { returnDocument: "after" },
    );
    if (!updatedAttribute) {
      throw new NotFoundError("failed to update contentCollection");
    }
    await this.contentCollectionService.updateSchema(attribute, updatedAttribute);
    return updatedAttribute;
  }

  private async deleteValidation(id: string): Promise<{ attribute: Attribute; contentCollection: ContentCollection }> {
    const attribute = await this.collection.findOne({ _id: new ObjectId(id) }, { projection: { key: 1, contentCollectionId: 1 } });
    if (!attribute) {
      throw new NotFoundError("attribute not found");
    }
    const contentCollection = await this.contentCollectionService.getById(attribute.contentCollectionId?.toString() || "");
    if (!contentCollection) {
      throw new NotFoundError("content collection not found for this attribute setting");
    }
    if (!contentCollection.schema?.properties?.[attribute.key]) {
      throw new NotFoundError("this attribute is not found in the schema");
    }
    return {
      attribute,
      contentCollection,
    };
  }

  async delete(id: string): Promise<DeleteAttributeResponse> {
    const { attribute, contentCollection } = await this.deleteValidation(id);
    await this.collection.deleteOne({ _id: new ObjectId(id) });
    await this.contentCollectionService.deleteSchema(contentCollection, attribute.key);
    await this.contentCollectionService.updateAttributeCount(contentCollection._id!);
    return { status: "success", data: attribute };
  }

  private validateAttributeValidation(type: AttributeTypeEnum, validation?: ValidationRules, format?: AttributeFormatEnum) {
    if (!validation) return;
    const { minLength, maxLength, minimum, maximum, pattern } = validation;
    const normalizedFormat = format && format.trim() ? format.trim() : undefined;
    switch (type) {
      case AttributeTypeEnum.STRING:
        if (minLength !== undefined && typeof minLength !== "number") {
          throw new ValidationError("validation.minLength must be a number");
        }
        if (maxLength !== undefined && typeof maxLength !== "number") {
          throw new ValidationError("validation.maxLength must be a number");
        }
        if (pattern !== undefined && typeof pattern !== "string") {
          throw new ValidationError("validation.pattern must be a string (regex)");
        }
        const hasLengthRules = minLength !== undefined || maxLength !== undefined;
        const hasPattern = pattern !== undefined && pattern.trim() !== "";
        if (hasLengthRules && hasPattern) {
          throw new ValidationError("You cannot provide both (minLength / maxLength) and pattern. Choose one validation strategy.");
        }
        if (minimum !== undefined || maximum !== undefined) {
          throw new ValidationError("minimum/maximum cannot be used for type=string");
        }
        if (format !== undefined && !Object.values(AttributeFormatEnum).includes(format)) {
          throw new ValidationError(`Format must be one of: ${Object.values(AttributeFormatEnum).join(", ")}`);
        }
        if (minLength !== undefined && maxLength !== undefined) {
          if (minLength > maxLength) {
            throw new ValidationError("minLength cannot be greater than maxLength");
          }
        }

        break;

      case AttributeTypeEnum.NUMBER:
        if (minimum !== undefined && typeof minimum !== "number") {
          throw new ValidationError("validation.minimum must be a number");
        }
        if (maximum !== undefined && typeof maximum !== "number") {
          throw new ValidationError("validation.maximum must be a number");
        }
        if (minLength !== undefined || maxLength !== undefined || pattern !== undefined) {
          throw new ValidationError("minLength/maxLength/pattern cannot be used for type=number");
        }
        if (format !== undefined) {
          throw new ValidationError("format cannot be set for type=number");
        }
        if (minimum !== undefined && maximum !== undefined) {
          if (minimum > maximum) {
            throw new ValidationError("minimum cannot be greater than maximum");
          }
        }

        break;

      case AttributeTypeEnum.BOOLEAN:
        if (minLength !== undefined || maxLength !== undefined || pattern !== undefined || minimum !== undefined || maximum !== undefined) {
          throw new ValidationError(`validation is not supported for type=${type}`);
        }
        if (format !== undefined) {
          throw new ValidationError("format cannot be set for this type");
        }
        break;

      default:
        throw new ValidationError(`Unknown attribute type: ${type}`);
    }
  }

  private validateDefaultValue(attributeType: string, defaultValue: string) {
    switch (attributeType) {
      case AttributeTypeEnum.STRING:
        if (typeof defaultValue !== "string" || !defaultValue.trim()) {
          throw new ValidationError("defaultValue must be a non-empty string");
        }
        break;
      case AttributeTypeEnum.NUMBER:
        if (typeof defaultValue !== "number") {
          throw new ValidationError("defaultValue must be a number");
        }
        break;
      case AttributeTypeEnum.BOOLEAN:
        if (typeof defaultValue !== "boolean") {
          throw new ValidationError("defaultValue must be a boolean");
        }
        break;
    }
  }

  private validateEnumValue(enumValues: string[]) {
    if (!Array.isArray(enumValues) || enumValues.length === 0) {
      throw new ValidationError("enumValues must be a non-empty array of strings");
    }
    if (enumValues.some((v) => typeof v !== "string" || !v.trim())) {
      throw new ValidationError("enumValues must contain only non-empty strings");
    }
  }

  async getValidationSchema(contentCollection: ContentCollection): Promise<any> {
    if (!contentCollection.schema) {
      throw new Error("Content collection has no schema");
    }

    const schema = JSON.parse(JSON.stringify(contentCollection.schema));

    // Ensure base object structure
    schema.type = schema.type ?? "object";
    schema.properties ||= {};
    schema.required ||= [];
    schema.additionalProperties = schema.additionalProperties ?? false;

    const attributesWithComponents = await this.collection
      .aggregate([
        { $match: { contentCollectionId: new ObjectId(contentCollection._id) } },
        {
          $lookup: {
            from: "attribute-components",
            localField: "componentRefId",
            foreignField: "_id",
            as: "component",
          },
        },
        { $unwind: { path: "$component", preserveNullAndEmptyArrays: true } },
        {
          $project: {
            key: 1,
            attributeKind: 1,
            componentSchema: "$component.schema",
            componentRepeatable: "$component.repeatable",
          },
        },
      ])
      .toArray();

    for (const attr of attributesWithComponents) {
      if (attr.attributeKind === AttributeKindEnum.COMPONENT && attr.componentSchema) {
        const finalSchema = {
          ...attr.componentSchema,
        };
        schema.properties[attr.key] = finalSchema;
      }
    }

    return schema;
  }
}

export default AttributeService;
