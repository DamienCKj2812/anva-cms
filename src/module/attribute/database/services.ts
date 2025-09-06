import { ObjectId, Db, Collection, FindOptions } from "mongodb";
import { getCurrentOrganizationId, getCurrentUserId } from "../../../utils/helper.auth";
import { validateObjectId } from "../../../utils/helper.mongo";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../../utils/helper.errors";
import { filterFields, WithMetaData } from "../../../utils/helper";
import { QueryOptions, findWithOptions } from "../../../utils/helper";
import { AppContext } from "../../../utils/helper.context";
import { Attribute, AttributeTypeEnum, CreateAttributeData, FormatTypeEnum, UpdateAttributeData, ValidationRules } from "./models";
import ContentCollectionService from "../../content-collection/database/services";
import { ContentCollection } from "../../content-collection/database/models";

class AttributeService {
  private context: AppContext;
  private db: Db;
  private collection: Collection<Attribute>;
  public readonly collectionName = "attributes";
  private static readonly ALLOWED_UPDATE_FIELDS: ReadonlySet<keyof UpdateAttributeData> = new Set([
    "label",
    "format",
    "required",
    "defaultValue",
    "enumValues",
    "validation",
  ] as const);
  private contentCollectionService: ContentCollectionService;

  constructor(context: AppContext) {
    this.context = context;
    this.db = context.mongoDatabase;
    this.collection = this.db.collection<Attribute>(this.collectionName);
  }

  async init() {
    this.contentCollectionService = this.context.diContainer!.get("ContentCollectionService");
  }

  async validateAttributeValidation(type: AttributeTypeEnum, validation: ValidationRules | undefined, format?: FormatTypeEnum) {
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
        if (minimum !== undefined || maximum !== undefined) {
          throw new ValidationError("minimum/maximum cannot be used for type=string");
        }
        if (format !== undefined && !Object.values(FormatTypeEnum).includes(format)) {
          throw new ValidationError(`Format must be one of: ${Object.values(FormatTypeEnum).join(", ")}`);
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
        break;

      case AttributeTypeEnum.BOOLEAN:
      case AttributeTypeEnum.ARRAY:
      case AttributeTypeEnum.OBJECT:
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

  private async createValidation(
    organizationId: ObjectId,
    data: CreateAttributeData
  ): Promise<{ validatedData: CreateAttributeData; contentCollection: ContentCollection }> {
    const { contentCollectionId, key, label, type, required, format, defaultValue, enumValues, validation } = data;
    if (!("contentCollectionId" in data)) {
      throw new ValidationError('"contentCollectionId" field is required');
    }
    if (!("key" in data)) {
      throw new ValidationError('"key" field is required');
    }
    if (!("label" in data)) {
      throw new ValidationError('"label" field is required');
    }
    if (!("type" in data)) {
      throw new ValidationError('"type" field is required');
    }
    if (!("required" in data)) {
      throw new ValidationError('"required" field is required');
    }
    const contentCollection = await this.contentCollectionService.getById(contentCollectionId);
    if (!contentCollection) {
      throw new NotFoundError("content collection not found");
    }
    if (typeof key !== "string" || !key.trim()) {
      throw new ValidationError("key must be a non-empty string");
    }
    if (contentCollection.schema?.properties?.[key]) {
      throw new ValidationError(`"${key}" key already exists in the content collection`);
    }
    if (typeof label !== "string" || !label.trim()) {
      throw new ValidationError("label must be a non-empty string");
    }
    if (!Object.values(AttributeTypeEnum).includes(type)) {
      throw new ValidationError(`Attribute type must be one of: ${Object.values(AttributeTypeEnum).join(", ")}`);
    }
    if (typeof required !== "boolean") {
      throw new ValidationError("required must be a boolean");
    }
    if (format !== undefined && !Object.values(FormatTypeEnum).includes(format)) {
      throw new ValidationError(`Format type must be one of: ${Object.values(FormatTypeEnum).join(", ")}`);
    }
    if (defaultValue !== undefined) {
      switch (type) {
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
        case AttributeTypeEnum.ARRAY:
          if (!Array.isArray(defaultValue)) {
            throw new ValidationError("defaultValue must be an array");
          }
          break;
        case AttributeTypeEnum.OBJECT:
          if (typeof defaultValue !== "object" || Array.isArray(defaultValue)) {
            throw new ValidationError("defaultValue must be an object");
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
    if (validation !== undefined) {
      await this.validateAttributeValidation(type, validation, format);
    }
    return { validatedData: data, contentCollection };
  }

  async create(data: CreateAttributeData): Promise<Attribute> {
    const organizationId = getCurrentOrganizationId(this.context);
    if (!organizationId) {
      throw new ValidationError('"organizationId" field is required');
    }
    const { validatedData, contentCollection } = await this.createValidation(organizationId, data);
    const createdBy = getCurrentUserId(this.context);

    console.log("Creating attribute: ", validatedData);
    const newAttribute: Attribute = {
      contentCollectionId: new ObjectId(validatedData.contentCollectionId),
      key: validatedData.key,
      label: validatedData.label,
      type: validatedData.type,
      format: validatedData.format,
      required: validatedData.required,
      defaultValue: validatedData.defaultValue,
      enumValues: validatedData.enumValues,
      validation: validatedData.validation,
      position: contentCollection.attributeCount,
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
    return { _id: result.insertedId, ...newAttribute };
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

  private async updateValidation(attribute: Attribute, data: UpdateAttributeData): Promise<UpdateAttributeData> {
    const { label, required, format, defaultValue, enumValues, validation } = data;
    if (
      !("label" in data) &&
      !("required" in data) &&
      !("format" in data) &&
      !("defaultValue" in data) &&
      !("enumValues" in data) &&
      !("validation" in data)
    ) {
      throw new NotFoundError("No valid fields provided for update");
    }
    if (label && (typeof label !== "string" || !label.trim())) {
      throw new ValidationError("label must be a non-empty string");
    }
    if (required && typeof required !== "boolean") {
      throw new ValidationError("required must be a boolean");
    }
    if (format !== undefined && !Object.values(FormatTypeEnum).includes(format)) {
      throw new ValidationError(`Format type must be one of: ${Object.values(FormatTypeEnum).join(", ")}`);
    }
    if (defaultValue !== undefined) {
      switch (attribute.type) {
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
        case AttributeTypeEnum.ARRAY:
          if (!Array.isArray(defaultValue)) {
            throw new ValidationError("defaultValue must be an array");
          }
          break;
        case AttributeTypeEnum.OBJECT:
          if (typeof defaultValue !== "object" || Array.isArray(defaultValue)) {
            throw new ValidationError("defaultValue must be an object");
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
    if (validation !== undefined) {
      const { minLength, maxLength, minimum, maximum, pattern } = validation;
      if (minLength !== undefined && typeof minLength !== "number") {
        throw new ValidationError("validation.minLength must be a number");
      }
      if (maxLength !== undefined && typeof maxLength !== "number") {
        throw new ValidationError("validation.maxLength must be a number");
      }
      if (minimum !== undefined && typeof minimum !== "number") {
        throw new ValidationError("validation.minimum must be a number");
      }
      if (maximum !== undefined && typeof maximum !== "number") {
        throw new ValidationError("validation.maximum must be a number");
      }
      if (pattern !== undefined && typeof pattern !== "string") {
        throw new ValidationError("validation.pattern must be a string (regex)");
      }

      if (validation !== undefined) {
        await this.validateAttributeValidation(attribute.type, validation, format);
      }
    }
    return data;
  }

  async update(id: string, data: UpdateAttributeData): Promise<Attribute> {
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
    const updatedcontentCollection = await this.collection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: updatingFields, $currentDate: { updatedAt: true } },
      { returnDocument: "after" }
    );
    if (!updatedcontentCollection) {
      throw new NotFoundError("failed to update contentCollection");
    }
    await this.contentCollectionService.updateSchema(attribute, validatedData);
    return updatedcontentCollection;
  }
  
}

export default AttributeService;
