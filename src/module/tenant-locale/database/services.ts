import { ObjectId, Db, Collection, FindOptions, Filter } from "mongodb";
import { validateObjectId } from "../../../utils/helper.mongo";
import { BadRequestError, ConflictError, NotFoundError, ValidationError } from "../../../utils/helper.errors";
import { filterFields, WithMetaData } from "../../../utils/helper";
import { QueryOptions, findWithOptions } from "../../../utils/helper";
import { AppContext } from "../../../utils/helper.context";
import { BaseService } from "../../core/base-service";
import { CreateTenantLocaleData, TenantLocale, UpdateTenantLocaleData } from "./models";
import TenantService from "../../tenant/database/services";
import ContentTranslationService from "../../content-translation/database/services";
import ContentService from "../../content/database/services";
import { getCurrentUserId } from "../../../utils/helper.auth";
import { Tenant } from "../../tenant/database/models";

class TenantLocaleService extends BaseService {
  private db: Db;
  private collection: Collection<TenantLocale>;
  public readonly collectionName = "tenant-locales";
  private static readonly ALLOWED_UPDATE_FIELDS: ReadonlySet<keyof UpdateTenantLocaleData> = new Set(["displayName", "locale"] as const);
  private tenantService: TenantService;
  private contentService: ContentService;
  private contentTranslationService: ContentTranslationService;

  constructor(context: AppContext) {
    super(context);
    this.db = context.mongoDatabase;
    this.collection = this.db.collection<TenantLocale>(this.collectionName);
  }

  async init() {
    this.tenantService = this.getService("TenantService");
    this.contentService = this.getService("ContentService");
    this.contentTranslationService = this.getService("ContentTranslationService");
  }

  private async createValidation(data: CreateTenantLocaleData, tenant: Tenant): Promise<CreateTenantLocaleData> {
    const { locale, displayName } = data;

    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/i.test(locale)) {
      throw new ValidationError("locale can only contain letters, numbers, and single hyphens (no spaces)");
    }
    if (typeof locale !== "string" || !locale.trim()) {
      throw new ValidationError("locale must be a non-empty string");
    }
    const exists = await this.collection.findOne({
      tenantId: tenant._id,
      locale: locale.trim(),
    });
    if (exists) {
      throw new ValidationError("locale already exists for this tenant");
    }
    if (!("displayName" in data)) {
      throw new ValidationError('"displayName" field is required');
    }
    if (typeof displayName !== "string" || !displayName.trim()) {
      throw new ValidationError("displayName must be a non-empty string");
    }
    const createdBy = getCurrentUserId(this.context);
    const existingTenantLocale = await this.collection.findOne({
      tenantId: tenant._id,
      locale: locale.trim(),
      createdBy,
    });
    if (existingTenantLocale) {
      throw new ConflictError("locale already exists");
    }
    return data;
  }

  async create({ data, tenant, isDefault = false }: { data: CreateTenantLocaleData; tenant: Tenant; isDefault?: boolean }): Promise<TenantLocale> {
    const { locale, displayName } = await this.createValidation(data, tenant);
    const createdBy = getCurrentUserId(this.context);

    console.log("Creating tenant:", displayName);
    const newTenantLocale: TenantLocale = {
      _id: new ObjectId(),
      tenantId: tenant._id,
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

  async getRemainingLocales(contentId: string): Promise<TenantLocale[]> {
    const content = await this.contentService.findOne({ _id: new ObjectId(contentId) });
    if (!content) {
      throw new NotFoundError("content not found");
    }
    const tenantLocales = await this.findMany({
      tenantId: content.tenantId,
    });
    const translations = await this.contentTranslationService.findMany({
      contentId: content._id,
    });
    const createdLocales = new Set(translations.map((t) => t.locale));
    const remainingLocales = tenantLocales.filter((t) => !createdLocales.has(t.locale));
    return remainingLocales;
  }

  async findOne(filter: Partial<TenantLocale>, options?: FindOptions<TenantLocale>): Promise<TenantLocale | null> {
    return await this.collection.findOne(filter, options);
  }

  async findMany(filter: Filter<TenantLocale>, options?: FindOptions<TenantLocale>): Promise<TenantLocale[]> {
    return this.collection.find(filter, options).toArray();
  }

  private async updateValidation(tenantLocale: TenantLocale, data: UpdateTenantLocaleData): Promise<Partial<TenantLocale>> {
    const { displayName, locale } = data;
    if (!("displayName" in data) && !("locale" in data)) {
      throw new BadRequestError("No valid fields provided for update");
    }
    if ("displayName" in data) {
      if (typeof displayName !== "string" || !displayName.trim()) {
        throw new ValidationError("displayName must be a non-empty string");
      }
      const exists = await this.collection.findOne({
        tenantId: tenantLocale.tenantId,
        displayName: displayName.trim(),
        _id: { $ne: tenantLocale._id }, // exclude current
      });
      if (exists) {
        throw new ValidationError("displayName already exists for this tenant");
      }
    }
    if ("locale" in data && locale) {
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/i.test(locale)) {
        throw new ValidationError("locale can only contain letters, numbers, and single hyphens (no spaces)");
      }
      if (typeof locale !== "string" || !locale.trim()) {
        throw new ValidationError("locale must be a non-empty string");
      }
      if (locale.trim() === tenantLocale.locale) {
        throw new ValidationError("locale is the same as existing value");
      }
      const exists = await this.collection.findOne({
        tenantId: tenantLocale.tenantId,
        locale: locale.trim(),
        _id: { $ne: tenantLocale._id }, // exclude current
      });
      if (exists) {
        throw new ValidationError("locale already exists for this tenant");
      }
    }
    return data;
  }

  async update(tenantLocale: TenantLocale, data: UpdateTenantLocaleData): Promise<TenantLocale> {
    const filteredUpdateData = filterFields(data, TenantLocaleService.ALLOWED_UPDATE_FIELDS);
    const validatedData = await this.updateValidation(tenantLocale, filteredUpdateData);
    const updatingFields: Partial<TenantLocale> = {
      ...validatedData,
    };
    if (filteredUpdateData.locale) {
      await this.contentTranslationService.updateMany({ tenantLocaleId: tenantLocale._id }, { $set: { locale: filteredUpdateData.locale } });
    }
    const updatedTenantLocale = await this.collection.findOneAndUpdate(
      { _id: tenantLocale._id },
      { $set: updatingFields, $currentDate: { updatedAt: true } },
      { returnDocument: "after" },
    );
    if (!updatedTenantLocale) {
      throw new NotFoundError("failed to update tenantLocale");
    }
    return updatedTenantLocale;
  }

  async delete(tenantLocale: TenantLocale): Promise<TenantLocale> {
    await this.contentTranslationService.getCollection().deleteMany({ tenantLocaleId: tenantLocale._id });

    const deletedTenantLocale = await this.collection.findOneAndDelete({
      _id: tenantLocale._id,
    });

    if (!deletedTenantLocale) {
      throw new NotFoundError("failed to delete tenantLocale");
    }

    return deletedTenantLocale;
  }
}

export default TenantLocaleService;
