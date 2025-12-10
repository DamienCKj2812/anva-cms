import { ObjectId, Db, Collection, FindOptions, Filter } from "mongodb";
import { getCurrentUserId } from "../../../utils/helper.auth";
import { validateObjectId } from "../../../utils/helper.mongo";
import { BadRequestError, NotFoundError, ValidationError } from "../../../utils/helper.errors";
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
  UpdatePrimitiveAttributeDTO,
  ValidationRules,
} from "./models";
import ContentCollectionService from "../../content-collection/database/services";
import { ContentCollection } from "../../content-collection/database/models";
import { BaseService } from "../../core/base-service";
import AttributeComponentService from "../../attribute-component/database/services";
import { AttributeComponent } from "../../attribute-component/database/models";
import { Content } from "../../content/database/models";
import ContentService from "../../content/database/services";
import ContentTranslationService from "../../content-translation/database/services";

class AttributeService extends BaseService {
  private db: Db;
  private collection: Collection<Attribute>;
  public readonly collectionName = "attributes";
  private static readonly ALLOWED_UPDATE_FIELDS: ReadonlySet<keyof UpdatePrimitiveAttributeDTO> = new Set([
    "label",
    "required",
    "localizable",
    "defaultValue",
    "enumValues",
    "validation",
  ] as const);
  private static readonly ALLOWED_UPDATE_VALIDATION_FIELDS: ReadonlySet<keyof ValidationRules> = new Set([
    "minLength",
    "maxLength",
    "minimum",
    "maximum",
    "pattern",
  ] as const);

  private contentCollectionService: ContentCollectionService;
  private attributeComponentService: AttributeComponentService;
  private contentService: ContentService;
  private contentTranslationService: ContentTranslationService;

  constructor(context: AppContext) {
    super(context);
    this.db = context.mongoDatabase;
    this.collection = this.db.collection<Attribute>(this.collectionName);
  }

  async init() {
    this.contentCollectionService = this.getService("ContentCollectionService");
    this.attributeComponentService = this.getService("AttributeComponentService");
    this.contentService = this.getService("ContentService");
    this.contentTranslationService = this.getService("ContentTranslationService");
  }

  getCollection(): Collection<Attribute> {
    return this.collection;
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
    let { key, label, required, attributeType, localizable, attributeFormat, defaultValue, enumValues, validation } = data;
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
    if (data.validation) {
      data.validation = filterFields(data.validation, AttributeService.ALLOWED_UPDATE_VALIDATION_FIELDS);
    }
    const validatedData = await this.createPrimitiveAttributeValidation(data, contentCollection);
    const createdBy = getCurrentUserId(this.context);

    console.log("Creating primitive attribute: ", validatedData);
    const attributeCount = await this.collection.countDocuments({ contentCollectionId: contentCollection._id });
    const newAttribute: Attribute = {
      _id: new ObjectId(),
      contentCollectionId: contentCollection._id,
      path: validatedData.key,
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
    await this.contentCollectionService.buildSchema(contentCollection);
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

  async createComponentAttribute(data: any, contentCollection: any): Promise<Attribute> {
    const { validatedData, attributeComponent } = await this.createComponentAttributeValidation(data, contentCollection);
    const createdBy = new ObjectId(); // Placeholder for getCurrentUserId(this.context);

    // 1. Calculate the new placeholder's path (Root-level path is just its key)
    const attributePath = validatedData.key;
    const attributeCount = await this.collection.countDocuments({ contentCollectionId: contentCollection._id });

    const newAttribute: Attribute = {
      _id: new ObjectId(),
      contentCollectionId: contentCollection._id,
      path: attributePath, // Set the path for the placeholder

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

    //  Insert the new placeholder attribute (CRITICAL STEP)
    const result = await this.collection.insertOne(newAttribute);
    if (!result) {
      throw new Error("Failed to create the component attribute");
    }

    //  RECURSIVELY CALCULATE ALL NESTED PATHS
    const allNestedPathUpdates = await this.buildPathsRecursively(
      newAttribute, // Start with the newly inserted attribute
      newAttribute.path, // The base path for recursion
    );

    //  Apply all path changes to the nested attributes
    const updatePromises = allNestedPathUpdates.map((update) => {
      // Use $set to update the 'path' field for every affected attribute
      return this.collection.findOneAndUpdate({ _id: update.id }, { $set: { path: update.path } });
    });

    await Promise.all(updatePromises);
    await this.contentCollectionService.buildSchema(contentCollection);
    await this.contentCollectionService.updateAttributeCount(contentCollection._id!);

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

  private async updatePrimitiveAttributeValidation(attribute: Attribute, data: UpdatePrimitiveAttributeDTO): Promise<UpdatePrimitiveAttributeDTO> {
    const { label, required, localizable, defaultValue, enumValues, validation } = data;
    if (attribute.attributeKind != AttributeKindEnum.PRIMITIVE) {
      throw new BadRequestError("only can modify the primitive attribute");
    }
    if (
      !("label" in data) &&
      !("required" in data) &&
      !("localizable" in data) &&
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

    if (validation !== undefined) {
      if (!attribute.attributeType) {
        throw new ValidationError("attribute is missing attributeType");
      }
      this.validateAttributeValidation(attribute.attributeType, validation, attribute.attributeFormat);
      console.log("silently correct");
    }
    return data;
  }

  async updatePrimitiveAttribute(attribute: Attribute, data: UpdatePrimitiveAttributeDTO, contentCollection: ContentCollection): Promise<Attribute> {
    if (data.validation) {
      data.validation = filterFields(data.validation, AttributeService.ALLOWED_UPDATE_VALIDATION_FIELDS);
    }
    const filteredUpdateData = filterFields(data, AttributeService.ALLOWED_UPDATE_FIELDS);
    const validatedData = await this.updatePrimitiveAttributeValidation(attribute, filteredUpdateData);

    const updatingFields: Partial<Attribute> = {
      ...validatedData,
    };
    const updatedAttribute = await this.collection.findOneAndUpdate(
      { _id: attribute._id },
      { $set: updatingFields, $currentDate: { updatedAt: true } },
      { returnDocument: "after" },
    );
    if (!updatedAttribute) {
      throw new NotFoundError("failed to update contentCollection");
    }
    await this.contentCollectionService.buildSchema(contentCollection);
    return updatedAttribute;
  }

  async delete(attribute: Attribute, contentCollection: ContentCollection): Promise<{ status: "success" | "failed"; data: any }> {
    if (attribute.attributeKind === AttributeKindEnum.COMPONENT_PRIMITIVE) {
      throw new BadRequestError(
        "Cannot delete an attribute that is defined inside a reusable component blueprint. Delete the attribute from the component blueprint instead.",
      );
    }

    const contentCollectionId = contentCollection._id!;
    const unsetObject: any = {};

    if (attribute.attributeKind === AttributeKindEnum.COMPONENT) {
      const allPaths = await this.buildPathsRecursively(attribute, attribute.path);
      for (const update of allPaths) {
        unsetObject[`data.${update.path}`] = "";
      }
    } else {
      unsetObject[`data.${attribute.path}`] = "";
    }

    const otherAttributeExists = await this.collection.findOne({
      contentCollectionId,
      _id: { $ne: attribute._id },
    });

    await this.collection.deleteOne({ _id: attribute._id });

    if (!otherAttributeExists) {
      await Promise.all([
        this.contentService.getCollection().deleteMany({ contentCollectionId }),
        this.contentTranslationService.getCollection().deleteMany({ contentCollectionId }),
      ]);
    } else {
      const query = { contentCollectionId };
      const unsetOperation = { $unset: unsetObject };

      await Promise.all([
        this.contentService.getCollection().updateMany(query, unsetOperation),
        this.contentTranslationService.getCollection().updateMany(query, unsetOperation),
      ]);
    }

    await this.contentCollectionService.updateAttributeCount(contentCollectionId);
    await this.contentCollectionService.buildSchema(contentCollection);

    return { status: "success", data: attribute };
  }

  public validateAttributeValidation(type: AttributeTypeEnum, validation?: ValidationRules, format?: AttributeFormatEnum) {
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

  public validateDefaultValue(attributeType: string, defaultValue: string) {
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

  public validateEnumValue(enumValues: string[]) {
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

  async buildPathsRecursively(targetAttribute: Attribute, newBasePath: string): Promise<{ id: ObjectId; path: string }[]> {
    const updates: { id: ObjectId; path: string }[] = [];

    updates.push({
      id: targetAttribute._id,
      path: newBasePath,
    });

    if (targetAttribute.attributeKind === AttributeKindEnum.COMPONENT) {
      const componentRefId = targetAttribute.componentRefId;

      if (componentRefId) {
        const nestedComponent = await this.attributeComponentService.findOne({ _id: componentRefId });

        if (nestedComponent && nestedComponent.attributes?.length) {
          let pathPrefix = newBasePath;

          if (nestedComponent.repeatable) {
            pathPrefix = `${newBasePath}[]`;
          }

          const nestedAttributes = await this.findMany({
            _id: { $in: nestedComponent.attributes },
          });

          for (const childAttribute of nestedAttributes) {
            const childPath = `${pathPrefix}.${childAttribute.key}`;

            const childUpdates = await this.buildPathsRecursively(childAttribute, childPath);

            updates.push(...childUpdates);
          }
        }
      }
    }

    return updates;
  }
}

export default AttributeService;
