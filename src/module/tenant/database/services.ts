import { ObjectId, Db, Collection, FindOptions } from "mongodb";
import { CreateTenantData, Tenant, UpdateTenantData } from "./models";
import { getCurrentUserId } from "../../../utils/helper.auth";
import { validateObjectId } from "../../../utils/helper.mongo";
import { BadRequestError, ConflictError, NotFoundError, ValidationError } from "../../../utils/helper.errors";
import { filterFields, WithMetaData } from "../../../utils/helper";
import { QueryOptions, findWithOptions } from "../../../utils/helper";
import { AppContext } from "../../../utils/helper.context";
import OrganizationService from "../../organization/database/services";

class TenantService {
  private context: AppContext;
  private db: Db;
  private collection: Collection<Tenant>;
  public readonly collectionName = "tenants";
  private static readonly ALLOWED_UPDATE_FIELDS: ReadonlySet<keyof UpdateTenantData> = new Set(["name", "slug"] as const);
  private organizationService: OrganizationService;

  constructor(context: AppContext) {
    this.context = context;
    this.db = context.mongoDatabase;
    this.collection = this.db.collection<Tenant>(this.collectionName);
  }

  async init() {
    this.organizationService = this.context.diContainer!.get("OrganizationService");
  }

  private async createValidation(data: CreateTenantData): Promise<CreateTenantData & { organizationId: ObjectId }> {
    const { name, slug } = data;
    const organizationId = this.context.currentUser?.organizationId;
    if (!organizationId) {
      throw new ValidationError('"organizationId" field is required');
    }
    if (!("name" in data)) {
      throw new ValidationError('"name" field is required');
    }
    if (!("slug" in data)) {
      throw new ValidationError('"slug" field is required');
    }
    const existingOrganization = await this.organizationService.getById(organizationId);
    if (!existingOrganization) {
      throw new NotFoundError('"Organization" not found');
    }
    if (typeof name !== "string" || !name.trim()) {
      throw new ValidationError("name must be a non-empty string");
    }
    if (typeof slug !== "string" || !slug.trim()) {
      throw new ValidationError("slug must be a non-empty string");
    }
    return {
      ...data,
      organizationId: new ObjectId(organizationId),
    };
  }

  async create(data: Tenant): Promise<Tenant> {
    const { name, slug } = await this.createValidation(data);
    const organizationId = this.context.currentUser?.organizationId;
    const createdBy = getCurrentUserId(this.context);

    console.log("Creating tenant:", name);
    const newTenant: Tenant = {
      slug,
      name: name.trim(),
      organizationId: new ObjectId(organizationId),
      createdAt: new Date(),
      createdBy,
    };

    const result = await this.collection.insertOne(newTenant);
    return { _id: result.insertedId, ...newTenant };
  }

  async getAll(queryOptions: QueryOptions): Promise<WithMetaData<Tenant>> {
    const options = {
      ...queryOptions,
      filter: {
        ...(queryOptions.filter || {}),
      },
    };
    return await findWithOptions(this.collection, options);
  }

  async getById(id: string): Promise<Tenant | null> {
    validateObjectId(id);
    return await this.collection.findOne({ _id: new ObjectId(id) });
  }

  async findOne(filter: Partial<Tenant>, options?: FindOptions<Tenant>): Promise<Tenant | null> {
    return await this.collection.findOne(filter, options);
  }

  private async updateValidation(tenant: Tenant, data: UpdateTenantData): Promise<Partial<Tenant>> {
    const { name, slug } = data;
    let updateTenantData: UpdateTenantData = { ...data };

    if (!("name" in data) && !("slug" in data)) {
      throw new BadRequestError("No valid fields provided for update");
    }

    if ("name" in data) {
      if (typeof name !== "string" || !name.trim()) {
        throw new ValidationError("name must be a non-empty string");
      }
      const existingTenant = await this.collection.findOne({
        organizationId: tenant.organizationId,
        name: name.trim(),
      });
      if (existingTenant) {
        throw new ConflictError("name already exists");
      }
      updateTenantData.name = name.trim();
    }

    if ("slug" in data) {
      if (typeof slug !== "string" || !slug.trim()) {
        throw new ValidationError("name must be a non-empty string");
      }
    }

    return { ...updateTenantData } as Promise<Partial<Tenant>>;
  }

  async update(id: string, data: UpdateTenantData): Promise<Tenant> {
    const tenant = await this.getById(id);
    if (!tenant) {
      throw new NotFoundError("Tenant not found");
    }

    const filteredUpdateData = filterFields(data, TenantService.ALLOWED_UPDATE_FIELDS);

    const validatedData = await this.updateValidation(tenant, filteredUpdateData);

    const updatingFields: Partial<Tenant> = {
      ...validatedData,
    };

    const updatedTenant = await this.collection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: updatingFields, $currentDate: { updatedAt: true } },
      { returnDocument: "after" }
    );

    if (!updatedTenant) {
      throw new NotFoundError("failed to update tenant");
    }

    return updatedTenant;
  }
}

export default TenantService;
