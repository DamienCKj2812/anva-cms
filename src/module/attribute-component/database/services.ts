import { ObjectId, Db, Collection, FindOptions, Filter } from "mongodb";
import { getCurrentUserId } from "../../../utils/helper.auth";
import { validateObjectId } from "../../../utils/helper.mongo";
import { BadRequestError, NotFoundError, ValidationError } from "../../../utils/helper.errors";
import { filterFields, WithMetaData } from "../../../utils/helper";
import { QueryOptions, findWithOptions } from "../../../utils/helper";
import { AppContext } from "../../../utils/helper.context";
import { BaseService } from "../../core/base-service";
import { AttributeComponent, CreateAttributeComponentDto, UpdateAttributeComponentDto } from "./models";
import AttributeService from "../../attribute/database/services";
import { Tenant } from "../../tenant/database/models";
import {
  Attribute,
  AttributeFormatEnum,
  AttributeKindEnum,
  AttributeTypeEnum,
  CreatePrimitiveAttributeDTO,
  UpdatePrimitiveAttributeDTO,
  ValidationRules,
} from "../../attribute/database/models";
import { ContentCollection } from "../../content-collection/database/models";
import ContentCollectionService from "../../content-collection/database/services";

class AttributeComponentService extends BaseService {
  private db: Db;
  private collection: Collection<AttributeComponent>;
  public readonly collectionName = "attribute-components";
  private static readonly ALLOWED_UPDATE_FIELDS: ReadonlySet<keyof UpdateAttributeComponentDto> = new Set(["label", "category"] as const);
  private static readonly ALLOWED_UPDATE_ATTRIBUTE_FIELDS: ReadonlySet<keyof UpdatePrimitiveAttributeDTO> = new Set([
    "label",
    "required",
    "attributeType",
    "localizable",
    "attributeFormat",
    "defaultValue",
    "enumValues",
    "validation",
    "repeatable",
  ] as const);
  private static readonly ALLOWED_UPDATE_VALIDATION_FIELDS: ReadonlySet<keyof ValidationRules> = new Set([
    "minLength",
    "maxLength",
    "minimum",
    "maximum",
    "pattern",
  ] as const);
  private attributeService: AttributeService;
  private contentCollectionService: ContentCollectionService;

  constructor(context: AppContext) {
    super(context);
    this.db = context.mongoDatabase;
    this.collection = this.db.collection<AttributeComponent>(this.collectionName);
  }

  async init() {
    this.attributeService = this.getService("AttributeService");
    this.contentCollectionService = this.getService("ContentCollectionService");
  }

  getCollection(): Collection<AttributeComponent> {
    return this.collection;
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
    const { key, label, category } = data;
    if (!("key" in data)) {
      throw new ValidationError('"key" field is required');
    }
    if (!("label" in data)) {
      throw new ValidationError('"label" field is required');
    }
    if (!("category" in data)) {
      throw new ValidationError('"category" field is required');
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

  private async updateValidation(data: UpdateAttributeComponentDto, attributeComponent: AttributeComponent): Promise<UpdateAttributeComponentDto> {
    if (!("label" in data) && !("category" in data)) {
      throw new NotFoundError("No valid fields provided for update");
    }
    const { label, category } = data;
    if (label !== undefined && (typeof label !== "string" || !label.trim())) {
      throw new ValidationError("label must be a non-empty string");
    }
    if (category !== undefined) {
      if (typeof data.category === "string") {
        data.category = data.category.trim();
      }
      if (!/^[A-Za-z0-9]+$/.test(category)) {
        throw new ValidationError("category may only contain letters and numbers (no spaces or symbols)");
      }
      if (typeof category !== "string" || !category.trim()) {
        throw new ValidationError("category must be a non-empty string");
      }

      const existedKey = await this.collection.findOne({ tenantId: attributeComponent.tenantId, category, key: attributeComponent.key });

      if (existedKey) {
        throw new ValidationError("key already exist");
      }
    }

    return data;
  }

  async update(data: UpdateAttributeComponentDto, attributeComponent: AttributeComponent): Promise<AttributeComponent> {
    const filteredUpdateData = filterFields(data, AttributeComponentService.ALLOWED_UPDATE_FIELDS);

    const validatedData = await this.updateValidation(filteredUpdateData, attributeComponent);
    console.log("updating attribute component: ", validatedData);
    const updatingFields: Partial<UpdateAttributeComponentDto> = {
      ...validatedData,
    };
    const updatedDocumentResult = await this.collection.findOneAndUpdate(
      { _id: attributeComponent._id },
      { $set: updatingFields, $currentDate: { updatedAt: true } },
      { returnDocument: "after" }, // Now valid
    );
    if (!updatedDocumentResult) {
      throw new NotFoundError("Failed to update the attribute component");
    }
    return updatedDocumentResult;
  }

  async delete(attributeComponent: AttributeComponent): Promise<{ status: "success" | "failed"; data: any }> {
    // Find all Content Collections that reference this component BEFORE deletion.
    const uniqueContentCollectionIds = await this.attributeService.getCollection().distinct("contentCollectionId", {
      componentRefId: attributeComponent._id,
      attributeKind: AttributeKindEnum.COMPONENT,
    });
    const validContentIds = uniqueContentCollectionIds.filter((id) => id) as ObjectId[];

    const deleteResult = await this.collection.deleteOne({ _id: attributeComponent._id });
    if (deleteResult.deletedCount === 0) {
      throw new Error(`Delete failed: Attribute component with ID ${attributeComponent._id} not found.`);
    }
    await this.attributeService.getCollection().deleteMany({ componentRefId: attributeComponent._id });

    if (validContentIds.length > 0) {
      const contentDocs = await this.contentCollectionService
        .getCollection()
        .find({ _id: { $in: validContentIds } })
        .toArray();
      const rebuildPromises = contentDocs.map(async (contentDoc) => {
        if (!contentDoc) return;

        const updatedContentDoc = await this.contentCollectionService.buildSchema(contentDoc);

        const fullSchema = await this.attributeService.getValidationSchema(updatedContentDoc || contentDoc);

        // c. REBUILD CONTENT DATA: Clean up content data based on the new schema (removing old component data)
        await this.contentCollectionService.rebuildContentData(updatedContentDoc || contentDoc, fullSchema);
      });

      await Promise.all(rebuildPromises);
    }

    // 5. Return success
    return {
      status: "success",
      data: attributeComponent,
    };
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
    const { key, label, required, attributeType, localizable, attributeFormat, defaultValue, enumValues, validation, repeatable } = data;
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
      attributeKind: AttributeKindEnum.COMPONENT_PRIMITIVE,
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

    if (repeatable !== undefined && attributeFormat != AttributeFormatEnum.MEDIA_URI) {
      throw new ValidationError("only media uri can be repeatable");
    }
    return data; // key is returned trimmed
  }

  async addAttributeInComponent(data: CreatePrimitiveAttributeDTO, attributeComponent: AttributeComponent): Promise<AttributeComponent> {
    const validatedData = await this.addAttributeValidation(data, attributeComponent);
    const createdBy = getCurrentUserId(this.context);

    console.log("adding primitive attribute into the component: ", validatedData);
    const newAttribute: Attribute = {
      _id: new ObjectId(),
      key: validatedData.key,
      label: validatedData.label,
      tenantId: attributeComponent.tenantId,
      attributeKind: AttributeKindEnum.COMPONENT_PRIMITIVE,
      componentRefId: attributeComponent._id,
      attributeType: validatedData.attributeType,
      attributeFormat: validatedData.attributeFormat,
      required: validatedData.required,
      defaultValue: validatedData.defaultValue,
      enumValues: validatedData.enumValues,
      validation: validatedData.validation,
      localizable: validatedData.localizable,
      repeatable: validatedData.repeatable,
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

    const newComponentAttribute = await this.buildSchemaForComponent(updatedComponent);
    await this.rebuildContentDataByComponent(newComponentAttribute);
    return updatedComponent;
  }

  private async updateAttributeValidation(attribute: Attribute, data: UpdatePrimitiveAttributeDTO): Promise<UpdatePrimitiveAttributeDTO> {
    const { label, required, attributeType, localizable, attributeFormat, defaultValue, enumValues, validation, repeatable } = data;
    if (attribute.attributeKind != AttributeKindEnum.COMPONENT_PRIMITIVE) {
      throw new BadRequestError("only can modify the component primitive attribute");
    }
    if (
      !("label" in data) &&
      !("required" in data) &&
      !("attributeType" in data) &&
      !("localizable" in data) &&
      !("attributeFormat" in data) &&
      !("defaultValue" in data) &&
      !("enumValues" in data) &&
      !("validation" in data) &&
      !("repeatable" in data)
    ) {
      throw new NotFoundError("No valid fields provided for update");
    }
    if (label !== undefined && (typeof label !== "string" || !label.trim())) {
      throw new ValidationError("label must be a non-empty string");
    }
    if (required !== undefined && typeof required !== "boolean") {
      throw new ValidationError("required must be a boolean");
    }
    if (attributeType !== undefined && !Object.values(AttributeTypeEnum).includes(attributeType)) {
      throw new ValidationError(`Attribute attributeType must be one of: ${Object.values(AttributeTypeEnum).join(", ")}`);
    }

    if (localizable && typeof localizable !== "boolean") {
      throw new ValidationError("localizable must be a boolean");
    }

    if (attributeFormat !== undefined && !Object.values(AttributeFormatEnum).includes(attributeFormat)) {
      throw new ValidationError(`Format type must be one of: ${Object.values(AttributeFormatEnum).join(", ")}`);
    }

    if (defaultValue !== undefined) {
      this.attributeService.validateDefaultValue((attributeType as AttributeTypeEnum) || attribute.attributeType, defaultValue);
    }

    if (enumValues !== undefined) {
      this.attributeService.validateEnumValue(enumValues);
    }

    if (validation !== undefined) {
      if (!attribute.attributeType) {
        throw new ValidationError("attribute is missing attributeType");
      }
      this.attributeService.validateAttributeValidation(attributeType || attribute.attributeType, validation, attribute.attributeFormat);
      console.log("silently correct");
    }

    if (repeatable !== undefined && (attributeFormat || attribute.attributeFormat) != AttributeFormatEnum.MEDIA_URI) {
      throw new ValidationError("only media uri can be repeatable");
    }
    return data;
  }

  async updateAttributeInComponent(
    data: UpdatePrimitiveAttributeDTO,
    attribute: Attribute,
    attributeComponent: AttributeComponent,
  ): Promise<AttributeComponent> {
    if (data.validation) {
      data.validation = filterFields(data.validation, AttributeComponentService.ALLOWED_UPDATE_VALIDATION_FIELDS);
    }
    const filteredUpdateData = filterFields(data, AttributeComponentService.ALLOWED_UPDATE_ATTRIBUTE_FIELDS);
    const validatedData = await this.updateAttributeValidation(attribute, filteredUpdateData);

    const updatingFields: Partial<Attribute> = {
      ...validatedData,
    };
    const updatedAttribute = await this.attributeService
      .getCollection()
      .findOneAndUpdate({ _id: attribute._id }, { $set: updatingFields, $currentDate: { updatedAt: true } }, { returnDocument: "after" });
    if (!updatedAttribute) {
      throw new NotFoundError("failed to update contentCollection");
    }
    const latestComponentDocument = await this.findOne({ _id: attributeComponent._id });
    if (!latestComponentDocument) {
      throw new NotFoundError(`Parent component not found for ID: ${attributeComponent._id}`);
    }
    const updatedComponentWithSchema = await this.buildSchemaForComponent(latestComponentDocument);
    await this.rebuildContentDataByComponent(updatedComponentWithSchema);
    return updatedComponentWithSchema;
  }

  async deleteAttributeInComponent(
    attribute: Attribute,
    attributeComponent: AttributeComponent,
  ): Promise<{ status: "success" | "failed"; data: any }> {
    if (attribute.attributeKind !== AttributeKindEnum.COMPONENT_PRIMITIVE) {
      throw new BadRequestError("Only attributes defined in the component can be deleted.");
    }
    const deleteResult = await this.attributeService.getCollection().deleteOne({ _id: attribute._id });
    if (deleteResult.deletedCount !== 1) {
      console.warn(`Attempted to delete attribute ID ${attribute._id} but deletedCount was ${deleteResult.deletedCount}`);
    }
    const componentUpdateResult = await this.collection.updateOne({ _id: attributeComponent._id }, { $pull: { attributes: attribute._id } });

    if (componentUpdateResult.modifiedCount === 0) {
      console.warn(
        `$pull operation failed for attribute ID ${attribute._id} in component ${attributeComponent._id}. It may have already been removed.`,
      );
    }

    const updatedComponent = await this.buildSchemaForComponent(attributeComponent);
    await this.rebuildContentDataByComponent(updatedComponent);

    return {
      status: "success",
      data: attribute,
    };
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

  async buildSchemaForComponent(attributeComponent: AttributeComponent): Promise<AttributeComponent> {
    let schema: any = {
      type: "object",
      properties: {},
      required: [] as string[],
      additionalProperties: false,
    };

    const attributes = await this.attributeService.findMany({ _id: { $in: attributeComponent.attributes } }, { sort: { position: 1 } });

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
        attributeId: attribute._id,
        localizable: attribute.localizable,
        ...attribute.validation,
      };

      if (attribute.attributeFormat) property.format = attribute.attributeFormat;
      if (attribute.enumValues?.length) property.enum = attribute.enumValues;
      if (attribute.defaultValue !== undefined) property.default = attribute.defaultValue;

      // Wrap in array if repeatable
      const finalProperty = attribute.repeatable
        ? {
            type: "array",
            items: property,
          }
        : property;

      schema.properties[attribute.key] = finalProperty;

      if (attribute.required) {
        schema.required.push(attribute.key);
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

  async rebuildContentDataByComponent(attributeComponent: AttributeComponent) {
    const { _id: componentRefId } = attributeComponent;

    const uniqueContentCollectionIds = await this.attributeService.getCollection().distinct("contentCollectionId", {
      componentRefId: componentRefId,
      attributeKind: AttributeKindEnum.COMPONENT,
    });

    const validContentIds = uniqueContentCollectionIds.filter((id) => id) as ObjectId[];

    if (validContentIds.length === 0) {
      console.log("No valid content collection IDs found for rebuilding.");
      return;
    }

    const contentDocs = await this.contentCollectionService
      .getCollection()
      .find({
        _id: { $in: validContentIds },
      })
      .toArray();

    console.dir({ contentDocs }, { depth: null });

    const rebuildPromises = contentDocs.map(async (contentDoc) => {
      if (!contentDoc) return;
      const fullSchema = await this.attributeService.getValidationSchema(contentDoc);
      await this.contentCollectionService.rebuildContentData(contentDoc, fullSchema);
    });

    await Promise.all(rebuildPromises);
  }
}

export default AttributeComponentService;
