import { ObjectId, Db, Collection, FindOptions } from "mongodb";
import { CreateUserData, UpdateUserData, User } from "./models";
import { getCurrentUserId, hashPassword } from "../../../utils/helper.auth";
import { validateObjectId } from "../../../utils/helper.mongo";
import { BadRequestError, ConflictError, NotFoundError, ValidationError } from "../../../utils/helper.errors";
import { filterFields, WithMetaData } from "../../../utils/helper";
import configs from "../../../configs";
import { QueryOptions, findWithOptions } from "../../../utils/helper";
import { AppContext } from "../../../utils/helper.context";
import { BaseService } from "../../core/base-service";
import TenantService from "../../tenant/database/services";

class UserService extends BaseService {
  private db: Db;
  private collection: Collection<User>;
  public readonly collectionName = "users";
  private static readonly ALLOWED_UPDATE_FIELDS: ReadonlySet<keyof UpdateUserData> = new Set(["username", "password"] as const);
  private tenantService: TenantService;

  constructor(context: AppContext) {
    super(context);
    this.db = context.mongoDatabase;
    this.collection = this.db.collection<User>(this.collectionName);
  }

  async init() {
    this.tenantService = this.getService("TenantService")
    const existingAdmin = await this.collection.findOne({
      username: configs.DEFAULT_ADMIN_ACCOUNT_USERNAME,
    });

    if (!existingAdmin) {
      const adminUser: User = {
        _id: new ObjectId(),
        username: configs.DEFAULT_ADMIN_ACCOUNT_USERNAME,
        password: await hashPassword(configs.DEFAULT_DEVELOPER_ACCOUNT_PASSWORD),
        orgBucketName: "",
        createdAt: new Date(),
        updatedAt: null,
      };

      await this.collection.insertOne(adminUser);

      try {
        await this.tenantService.create({
          name: "default-tenant",
          createdBy: adminUser._id,
        },);
      } catch (err) {
        console.error("Failed to create tenant for admin, rolling back:", err);
        await this.collection.deleteOne({ _id: adminUser._id });
        throw new Error("Tenant creation failed, admin user rolled back");
      }
    }
    await this.collection.createIndex({ username: 1 });
  }

  private async createValidation(data: CreateUserData): Promise<CreateUserData> {
    const { username, password } = data;
    if (!("username" in data)) {
      throw new ValidationError('"username" field is required');
    }
    if (!("password" in data)) {
      throw new ValidationError('"password" field is required');
    }
    if (typeof username !== "string" || !username.trim()) {
      throw new ValidationError("username must be a non-empty string");
    }
    if (typeof password !== "string" || password.length < 6) {
      throw new ValidationError("Password must be a string with at least 6 characters");
    }
    // Validate conflict values
    const existingUser = await this.collection.findOne({
      username: username.trim(),
    });
    if (existingUser) {
      throw new ConflictError("User username already exists");
    }

    return {
      ...data,
    };
  }

  async create(data: User): Promise<User> {
    const { username, password } = await this.createValidation(data);

    console.log("Creating user:", username);
    const newUser: User = {
      _id: new ObjectId(),
      username: username.trim(),
      orgBucketName: "",
      createdAt: new Date(),
      updatedAt: null,
      password: await hashPassword(password),
    };

    await this.collection.insertOne(newUser);

    try {
      await this.tenantService.create({
        name: "default-tenant",
        createdBy: newUser._id,
      });
    } catch (err) {
      console.error("Failed to create tenant, rolling back user creation:", err);
      await this.collection.deleteOne({ _id: newUser._id });
      throw new Error("Tenant creation failed, user rolled back");
    }

    return newUser;
  }

  async getAll(queryOptions: QueryOptions): Promise<WithMetaData<User>> {
    const options = {
      ...queryOptions,
      filter: {
        ...(queryOptions.filter || {}),
      },
    };
    return await findWithOptions(this.collection, options);
  }

  async getById(id: string): Promise<User | null> {
    validateObjectId(id);
    return await this.collection.findOne({ _id: new ObjectId(id) });
  }

  async findOne(filter: Partial<User>, options?: FindOptions<User>): Promise<User | null> {
    return await this.collection.findOne(filter, options);
  }

  private async updateValidation(data: UpdateUserData): Promise<Partial<User>> {
    const { username, password } = data;
    let updateUserData: UpdateUserData = { ...data };
    const userId = getCurrentUserId(this.context);

    if (!("username" in data) && !("password" in data)) {
      throw new BadRequestError("No valid fields provided for update");
    }

    if ("username" in data) {
      if (typeof username !== "string" || !username.trim()) {
        throw new ValidationError("username must be a non-empty string");
      }
      const existingUser = await this.collection.findOne({
        username: username.trim(),
        _id: { $ne: userId },
      });
      if (existingUser) {
        throw new ConflictError("username already exists");
      }
      updateUserData.username = username.trim();
    }

    if ("password" in data) {
      if (typeof password !== "string" || password.length < 6) {
        throw new ValidationError("Password must be a string with at least 6 characters");
      }
      updateUserData.password = await hashPassword(password);
    }

    return { ...updateUserData } as Promise<Partial<User>>;
  }

  async update(data: UpdateUserData): Promise<User> {
    const userId = getCurrentUserId(this.context);
    const filteredUpdateData = filterFields(data, UserService.ALLOWED_UPDATE_FIELDS);

    const validatedData = await this.updateValidation(filteredUpdateData);

    const updatingFields: Partial<User> = {
      ...validatedData,
    };

    const updatedUser = await this.collection.findOneAndUpdate(
      { _id: userId },
      { $set: updatingFields, $currentDate: { updatedAt: true } },
      { returnDocument: "after", projection: { password: 0 } }
    );

    if (!updatedUser) {
      throw new NotFoundError("failed to update user");
    }

    return updatedUser;
  }

  private async deleteUserValidation(id: string) {
    validateObjectId(id);

    const user = await this.collection.findOne({ _id: new ObjectId(id) }, { projection: { username: 1 } });

    if (!user) {
      throw new NotFoundError("user not found");
    }

    if (user.username === "admin") {
      throw new Error("This admin account cannot be deleted");
    }
  }

  async delete(id: string): Promise<void> {
    await this.deleteUserValidation(id);
    await this.collection.deleteOne({ _id: new ObjectId(id) });
  }
}

export default UserService;
