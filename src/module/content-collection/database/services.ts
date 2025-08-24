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
import { Organization } from "../../organization/database/models";

class ContentCollectionService {
  private context: AppContext;
  private db: Db;
  private collection: Collection<ContentCollection>;
  public readonly collectionName = "content-collections";
  private static readonly ALLOWED_UPDATE_FIELDS: ReadonlySet<keyof UpdateContentCollectionData> = new Set(["name", "displayName"] as const);
  private organizationService: OrganizationService;
  private tenantService: TenantService;

  constructor(context: AppContext) {
    this.context = context;
    this.db = context.mongoDatabase;
    this.collection = this.db.collection<ContentCollection>(this.collectionName);
  }

  async init() {
    this.organizationService = this.context.diContainer!.get("OrganizationService");
    this.tenantService = this.context.diContainer!.get("TenantService");
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
    const updatedcontentCollection = await this.collection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: updatingFields, $currentDate: { updatedAt: true } },
      { returnDocument: "after" }
    );
    if (!updatedcontentCollection) {
      throw new NotFoundError("failed to update contentCollection");
    }

    return updatedcontentCollection;
  }
}

export default ContentCollectionService;
