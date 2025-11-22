import { ObjectId, Db, Collection, FindOptions, Filter } from "mongodb";
import { getCurrentUserId } from "../../../utils/helper.auth";
import { validateObjectId } from "../../../utils/helper.mongo";
import { BadRequestError, ConflictError, NotFoundError, ValidationError } from "../../../utils/helper.errors";
import { filterFields, WithMetaData } from "../../../utils/helper";
import { QueryOptions, findWithOptions } from "../../../utils/helper";
import { AppContext } from "../../../utils/helper.context";
import { BaseService } from "../../core/base-service";
import { CreateTenantLocaleData, TenantLocale, UpdateTenantLocaleData } from "./models";
import TenantService from "../../tenant/database/services";

class TenantLocaleService extends BaseService {
  private db: Db;
  private collection: Collection<TenantLocale>;
  public readonly collectionName = "tenant-locales";
  private static readonly ALLOWED_UPDATE_FIELDS: ReadonlySet<keyof UpdateTenantLocaleData> = new Set(["displayName"] as const);
  private tenantService: TenantService;

  constructor(context: AppContext) {
    super(context);
    this.db = context.mongoDatabase;
    this.collection = this.db.collection<TenantLocale>(this.collectionName);
  }

  async init() {
    this.tenantService = this.getService("TenantService");
  }

  private async createValidation(data: CreateTenantLocaleData): Promise<CreateTenantLocaleData> {
    const { tenantId, locale, displayName } = data;
    const createdBy = getCurrentUserId(this.context);

    if (!("tenantId" in data)) {
      throw new ValidationError('"tenantId" field is required');
    }
    const existingTenant = await this.tenantService.findOne({
      _id: new ObjectId(tenantId),
    });
    if (!existingTenant) {
      throw new NotFoundError("Tenant not found");
    }
    if (!("locale" in data)) {
      throw new ValidationError('"locale" field is required');
    }
    if (typeof locale !== "string" || !locale.trim()) {
      throw new ValidationError("locale must be a non-empty string");
    }
    if (!("displayName" in data)) {
      throw new ValidationError('"displayName" field is required');
    }
    if (typeof displayName !== "string" || !displayName.trim()) {
      throw new ValidationError("displayName must be a non-empty string");
    }
    const existingTenantLocale = await this.collection.findOne({
      locale: locale.trim(),
      createdBy,
    });
    if (existingTenantLocale) {
      throw new ConflictError("locale already exists");
    }
    return data;
  }

  async create({ data, isDefault = false }: { data: CreateTenantLocaleData; isDefault?: boolean }): Promise<TenantLocale> {
    const { tenantId, locale, displayName } = await this.createValidation(data);
    const createdBy = getCurrentUserId(this.context);

    console.log("Creating tenantLocale:", displayName);
    const newTenantLocale: TenantLocale = {
      _id: new ObjectId(),
      tenantId: new ObjectId(tenantId),
      locale,
      displayName: displayName.trim(),
      isDefault,
      createdAt: new Date(),
      createdBy,
    };

    const result = await this.collection.insertOne(newTenantLocale);
    if (!result) {
      throw new Error("tenantLocale create failed");
    }
    return newTenantLocale;
  }

  async getAll(queryOptions: QueryOptions): Promise<WithMetaData<TenantLocale>> {
    const options = {
      ...queryOptions,
      filter: {
        ...(queryOptions.filter || {}),
      },
    };
    return await findWithOptions(this.collection, options);
  }

  async getById(id: string): Promise<TenantLocale | null> {
    validateObjectId(id);
    return await this.collection.findOne({ _id: new ObjectId(id) });
  }

  async findOne(filter: Partial<TenantLocale>, options?: FindOptions<TenantLocale>): Promise<TenantLocale | null> {
    return await this.collection.findOne(filter, options);
  }

  async findMany(filter: Filter<TenantLocale>, options?: FindOptions<TenantLocale>): Promise<TenantLocale[]> {
    return this.collection.find(filter, options).toArray();
  }

  private async updateValidation(tenantLocale: TenantLocale, data: UpdateTenantLocaleData): Promise<Partial<TenantLocale>> {
    const { displayName } = data;
    if (!("displayName" in data) && !("slug" in data)) {
      throw new BadRequestError("No valid fields provided for update");
    }
    if ("displayName" in data) {
      if (typeof displayName !== "string" || !displayName.trim()) {
        throw new ValidationError("displayName must be a non-empty string");
      }
    }
    return data;
  }

  async update(id: string, data: UpdateTenantLocaleData): Promise<TenantLocale> {
    const tenantLocale = await this.getById(id);
    if (!tenantLocale) {
      throw new NotFoundError("TenantLocale not found");
    }
    const filteredUpdateData = filterFields(data, TenantLocaleService.ALLOWED_UPDATE_FIELDS);
    const validatedData = await this.updateValidation(tenantLocale, filteredUpdateData);
    const updatingFields: Partial<TenantLocale> = {
      ...validatedData,
    };
    const updatedTenantLocale = await this.collection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: updatingFields, $currentDate: { updatedAt: true } },
      { returnDocument: "after" }
    );
    if (!updatedTenantLocale) {
      throw new NotFoundError("failed to update tenantLocale");
    }
    return updatedTenantLocale;
  }
}

export default TenantLocaleService;
