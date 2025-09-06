import { ObjectId, Db, Collection, FindOptions } from "mongodb";
import { validateObjectId } from "../../../utils/helper.mongo";
import { ConflictError, NotFoundError, ValidationError } from "../../../utils/helper.errors";
import configs from "../../../configs";
import { AppContext } from "../../../utils/helper.context";
import { CreateOrganizationData, Organization } from "./models";
import UserService from "../../user/database/services";
import { BaseService } from "../../core/base-service";

class OrganizationService extends BaseService {
  private db: Db;
  private collection: Collection<Organization>;
  public readonly collectionName = "organizations";
  private userService: UserService;

  constructor(context: AppContext) {
    super(context);
    this.db = context.mongoDatabase;
    this.collection = this.db.collection<Organization>(this.collectionName);
  }

  async init(): Promise<Organization> {
    this.userService = this.getService("UserService");
    // Check if there’s already an organization
    let existingOrganization = await this.findOne({});
    if (!existingOrganization) {
      const insertResult = await this.collection.insertOne({
        name: configs.DEFAULT_ADMIN_ACCOUNT_USERNAME,
        createdAt: new Date(),
      });
      // fetch the newly created document
      existingOrganization = await this.collection.findOne({ _id: insertResult.insertedId });
    }
    // If failed to create
    if (!existingOrganization) {
      throw new Error("Failed to initialize organization");
    }
    await this.collection.createIndex({ name: 1 }, { unique: true });
    return existingOrganization;
  }

  private async createValidation(data: CreateOrganizationData): Promise<CreateOrganizationData> {
    const { name } = data;

    if (!("name" in data)) {
      throw new ValidationError('"name" field is required');
    }
    if (typeof name !== "string" || !name.trim()) {
      throw new ValidationError("name must be a non-empty string");
    }

    // Validate conflict values
    const existingOrganization = await this.collection.findOne({
      name: name.trim(),
    });
    if (existingOrganization) {
      throw new ConflictError("Organization name already exists");
    }

    return data;
  }

  async create(data: CreateOrganizationData): Promise<Organization> {
    const validatedData = await this.createValidation(data);

    console.log("Creating organization:", validatedData.name);
    const newOrganization: Organization = {
      name: validatedData.name.trim(),
      createdAt: new Date(),
    };

    const result = await this.collection.insertOne(newOrganization);
    return { _id: result.insertedId, ...newOrganization };
  }

  async getById(id: string): Promise<Organization | null> {
    validateObjectId(id);
    return await this.collection.findOne({ _id: new ObjectId(id) });
  }

  async findOne(filter: Partial<Organization>, options?: FindOptions<Organization>): Promise<Organization | null> {
    return await this.collection.findOne(filter, options);
  }
}

export default OrganizationService;
