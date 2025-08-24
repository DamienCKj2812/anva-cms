import { ObjectId, Db, Collection, FindOptions } from "mongodb";
import { CreateUserData, UpdateUserData, User, UserRoleEnum } from "./models";
import { hashPassword } from "../../../utils/helper.auth";
import { validateObjectId } from "../../../utils/helper.mongo";
import { BadRequestError, ConflictError, NotFoundError, ValidationError } from "../../../utils/helper.errors";
import { filterFields, WithMetaData } from "../../../utils/helper";
import configs from "../../../configs";
import { QueryOptions, findWithOptions } from "../../../utils/helper";
import { AppContext } from "../../../utils/helper.context";
import { Organization } from "../../organization/database/models";
import OrganizationService from "../../organization/database/services";
import { Permissions } from "../../../utils/helper.permission";

class UserService {
  private context: AppContext;
  private db: Db;
  private collection: Collection<User>;
  public readonly collectionName = "users";
  private static readonly ALLOWED_UPDATE_FIELDS: ReadonlySet<keyof UpdateUserData> = new Set([
    "name",
    "password",
    "userRole",
    "permissions",
  ] as const);
  private organizationService: OrganizationService;

  constructor(context: AppContext) {
    this.context = context;
    this.db = context.mongoDatabase;
    this.collection = this.db.collection<User>(this.collectionName);
  }

  async init(organization: Organization) {
    this.organizationService = this.context.diContainer!.get("OrganizationService");

    if (!organization || !organization._id) {
      throw new ValidationError("Organization is missing, failed to initialize profile");
    }
    const orgId = organization._id;

    // Check before insert
    const existingAdmin = await this.collection.findOne({
      organizationId: orgId,
      name: configs.DEFAULT_ADMIN_ACCOUNT_USERNAME,
    });

    if (!existingAdmin) {
      await this.collection.insertOne({
        organizationId: orgId,
        name: configs.DEFAULT_ADMIN_ACCOUNT_USERNAME,
        password: await hashPassword(configs.DEFAULT_DEVELOPER_ACCOUNT_PASSWORD),
        userRole: UserRoleEnum.admin,
        permissions: [],
        createdAt: new Date(),
        updatedAt: null,
      });
    }
    await this.collection.createIndex({ name: 1 }, { unique: true });
  }

  private async createValidation(data: CreateUserData): Promise<CreateUserData & { organizationId: ObjectId }> {
    const { name, userRole, password, permissions } = data;
    const organizationId = this.context.currentUser?.organizationId;
    if (!organizationId) {
      throw new ValidationError('"organizationId" field is required');
    }
    if (!("name" in data)) {
      throw new ValidationError('"name" field is required');
    }
    if (!("userRole" in data)) {
      throw new ValidationError('"userRole" field is required');
    }
    if (!("password" in data)) {
      throw new ValidationError('"password" field is required');
    }
    if (!("permissions" in data)) {
      throw new ValidationError('"permissions" field is required');
    }
    const existingOrganization = await this.organizationService.getById(organizationId);
    if (!existingOrganization) {
      throw new NotFoundError('"Organization" not found');
    }
    if (typeof name !== "string" || !name.trim()) {
      throw new ValidationError("name must be a non-empty string");
    }
    if (!Object.values(UserRoleEnum).includes(userRole as UserRoleEnum)) {
      throw new ValidationError("Invalid Role");
    }
    if (typeof password !== "string" || password.length < 6) {
      throw new ValidationError("Password must be a string with at least 6 characters");
    }
    if (!Array.isArray(permissions)) {
      throw new ValidationError('"permissions" must be an array');
    }
    for (const p of permissions) {
      if (!Object.values(Permissions).includes(p)) {
        throw new ValidationError(`${p} is not a valid option`);
      }
    }
    // Validate conflict values
    const existingUser = await this.collection.findOne({
      name: name.trim(),
      organizationId: new ObjectId(organizationId),
    });
    if (existingUser) {
      throw new ConflictError("User name already exists");
    }

    return {
      ...data,
      organizationId: new ObjectId(organizationId),
    };
  }

  async create(data: User): Promise<User> {
    const { name, organizationId, password, permissions, userRole } = await this.createValidation(data);

    console.log("Creating user:", name);
    const newUser: User = {
      name: name.trim(),
      userRole,
      organizationId,
      permissions,
      createdAt: new Date(),
      updatedAt: null,
      password: await hashPassword(password),
    };

    const result = await this.collection.insertOne(newUser);
    return { _id: result.insertedId, ...newUser };
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

  private async updateValidation(user: User, data: UpdateUserData): Promise<Partial<User>> {
    const { name, userRole, password, permissions } = data;
    let updateUserData: UpdateUserData = { ...data };

    if (!("name" in data) && !("password" in data) && !("permissions" in data) && !("userRole" in data)) {
      throw new BadRequestError("No valid fields provided for update");
    }

    if ("name" in data) {
      if (typeof name !== "string" || !name.trim()) {
        throw new ValidationError("name must be a non-empty string");
      }
      const existingUser = await this.collection.findOne({
        name: name.trim(),
        _id: { $ne: user._id },
      });
      if (existingUser) {
        throw new ConflictError("name already exists");
      }
      updateUserData.name = name.trim();
    }

    if ("userRole" in data) {
      if (!Object.values(UserRoleEnum).includes(userRole as UserRoleEnum)) {
        throw new ValidationError("Invalid role");
      }
    }

    if ("password" in data) {
      if (typeof password !== "string" || password.length < 6) {
        throw new ValidationError("Password must be a string with at least 6 characters");
      }
      updateUserData.password = await hashPassword(password);
    }

    if ("permissions" in data && permissions) {
      if (!Array.isArray(permissions)) {
        throw new ValidationError('"permissions" must be an array');
      }

      const validatedPermissions: Permissions[] = [];

      for (const p of permissions) {
        if (!Object.values(Permissions).includes(p as Permissions)) {
          throw new ValidationError(`${p} is not a valid option`);
        }
        validatedPermissions.push(p as Permissions);
      }

      updateUserData.permissions = validatedPermissions;
    }

    return { ...updateUserData } as Promise<Partial<User>>;
  }

  async update(id: string, data: UpdateUserData): Promise<User> {
    const user = await this.getById(id);
    if (!user) {
      throw new NotFoundError("User not found");
    }

    const filteredUpdateData = filterFields(data, UserService.ALLOWED_UPDATE_FIELDS);

    const validatedData = await this.updateValidation(user, filteredUpdateData);

    const updatingFields: Partial<User> = {
      ...validatedData,
    };

    const updatedUser = await this.collection.findOneAndUpdate(
      { _id: new ObjectId(id) },
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

    const user = await this.collection.findOne({ _id: new ObjectId(id) }, { projection: { name: 1 } });

    if (!user) {
      throw new NotFoundError("user not found");
    }

    if (user.name === "admin") {
      throw new Error("This admin account cannot be deleted");
    }
  }

  async delete(id: string): Promise<void> {
    await this.deleteUserValidation(id);
    await this.collection.deleteOne({ _id: new ObjectId(id) });
  }
}

export default UserService;
