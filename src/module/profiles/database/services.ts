import { ObjectId, Db, Collection, FindOptions } from "mongodb";
import { CreateProfileData, UpdateProfileData, Profile, UserRoleEnum } from "./models";
import { hashPassword } from "../../../utils/helper.auth";
import { validateObjectId } from "../../../utils/helper.mongo";
import { BadRequestError, ConflictError, InternalServerError, NotFoundError, UnauthorizedError, ValidationError } from "../../../utils/helper.errors";
import { filterFields, WithMetaData } from "../../../utils/helper";
import configs from "../../../configs";
import { QueryOptions, findWithOptions } from "../../../utils/helper";
import { AppContext } from "../../../utils/helper.context";
import globalEventBus from "../../../utils/helper.eventBus";
import { SectionContent } from "../../section-content/database/model";

class ProfileService {
  private context: AppContext;
  private db: Db;
  private collection: Collection<Profile>;
  public readonly collectionName = "profiles";
  private static readonly ALLOWED_UPDATE_FIELDS: ReadonlySet<keyof UpdateProfileData> = new Set(["name", "password", "totalCredits"] as const);

  constructor(context: AppContext) {
    this.context = context;
    this.db = context.mongoDatabase;
    this.collection = this.db.collection<Profile>(this.collectionName);
    globalEventBus.on("llm:sectionContentCreated", async (event) => {
      await this.handleSectionContentCreated(event);
      console.log('[ProfileService] Subscribed to "llm:sectionContentCreated" events.');
    });
  }

  async init() {
    // Initialize an account
    const existingProfile = await this.findOne({});
    if (!existingProfile) {
      await this.collection.insertOne({
        name: configs.DEFAULT_ADMIN_ACCOUNT_USERNAME,
        password: await hashPassword(configs.DEFAULT_DEVELOPER_ACCOUNT_PASSWORD),
        userRole: UserRoleEnum.backoffice,
        totalCredits: 100000000,
        createdAt: new Date(),
        updatedAt: null,
      });
    }

    await this.collection.createIndex({ name: 1 }, { unique: true });
  }

  private async handleSectionContentCreated(sectionContent: SectionContent) {
    console.log(`[ProfileService] Received 'llm:sectionContentCreated' for content ID: ${sectionContent._id}`);

    const profileId = this.context.currentProfile?.id;
    const tokensUsed = (sectionContent.inputTokens ?? 0) + (sectionContent.outputTokens ?? 0);

    // If profile or tokens are invalid, just log and return
    if (!profileId || tokensUsed === 0) {
      console.warn("[ProfileService] Upload credit skipped: invalid profileId or no tokens used");
      return;
    }

    const currentProfile = await this.getById(profileId);
    if (!currentProfile) {
      console.warn(`[ProfileService] Upload credit skipped: profile not found for ID ${profileId}`);
      return;
    }

    const newTotalCredits = currentProfile.totalCredits - tokensUsed;
    const updatedProfile = await this.update(profileId, { totalCredits: newTotalCredits });

    globalEventBus.emit("profile:creditsUpdated", {
      profileId: updatedProfile._id,
      newBalance: updatedProfile.totalCredits,
    });

    console.log(`[ProfileService] Credits updated successfully for profile ID: ${updatedProfile._id}`);
    return updatedProfile;
  }

  private async createValidation(data: Partial<CreateProfileData>) {
    const { name, userRole, password } = data;

    if (!("name" in data)) {
      throw new ValidationError('"name" field is required');
    }
    if (!("userRole" in data)) {
      throw new ValidationError('"userRole" field is required');
    }
    if (!("password" in data)) {
      throw new ValidationError('"password" field is required');
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

    // Validate conflict values
    const existingProfile = await this.collection.findOne({
      name: name.trim(),
    });
    if (existingProfile) {
      throw new ConflictError("Profile name already exists");
    }
  }

  async create(data: CreateProfileData): Promise<Profile> {
    await this.createValidation(data);

    const { name, userRole, password } = data as { name: string; userRole: UserRoleEnum; password: string };
    console.log("Creating profile:", name);
    const newProfile: Profile = {
      name: name.trim(),
      userRole,
      createdAt: new Date(),
      updatedAt: null,
      totalCredits: 0,
      password: await hashPassword(password),
    };

    const result = await this.collection.insertOne(newProfile);
    return { _id: result.insertedId, ...newProfile };
  }

  async getAll(queryOptions: QueryOptions): Promise<WithMetaData<Profile>> {
    const options = {
      ...queryOptions,
      filter: {
        ...(queryOptions.filter || {}),
      },
    };
    return await findWithOptions(this.collection, options);
  }

  async getById(id: string): Promise<Profile | null> {
    validateObjectId(id);
    return await this.collection.findOne({ _id: new ObjectId(id) });
  }

  async findOne(filter: Partial<Profile>, options?: FindOptions<Profile>): Promise<Profile | null> {
    return await this.collection.findOne(filter, options);
  }

  private async updateValidation(profile: Profile, data: UpdateProfileData): Promise<UpdateProfileData> {
    const { name, userRole, password, totalCredits } = data;
    let updateProfileData: UpdateProfileData = { ...data };

    if (!("name" in data) && !("password" in data) && !("totalCredits" in data) && !("userRole" in data)) {
      throw new BadRequestError("No valid fields provided for update");
    }

    if ("name" in data) {
      if (typeof name !== "string" || !name.trim()) {
        throw new ValidationError("name must be a non-empty string");
      }
      const existingProfile = await this.collection.findOne({
        name: name.trim(),
        _id: { $ne: profile._id },
      });
      if (existingProfile) {
        throw new ConflictError("name already exists");
      }
      updateProfileData.name = name.trim();
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
      updateProfileData.password = await hashPassword(password);
    }

    if ("totalCredits" in data) {
      if (typeof totalCredits != "number" || totalCredits <= 0) {
        throw new ValidationError("Update credit amount must be a number with more than 0 credit amount");
      }
    }

    return updateProfileData;
  }

  async update(id: string, data: UpdateProfileData): Promise<Profile> {
    const profile = await this.getById(id);
    if (!profile) {
      throw new NotFoundError("Profile not found");
    }

    const filteredUpdateData = filterFields(data, ProfileService.ALLOWED_UPDATE_FIELDS);

    const validatedData = await this.updateValidation(profile, filteredUpdateData);

    const updatingFields: Partial<Profile> = {
      ...validatedData,
    };

    const updatedProfile = await this.collection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: updatingFields, $currentDate: { updatedAt: true } },
      { returnDocument: "after", projection: { password: 0 } }
    );

    if (!updatedProfile) {
      throw new NotFoundError("failed to update profile");
    }

    return updatedProfile;
  }

  private async deleteUserValidation(id: string) {
    validateObjectId(id);

    const profile = await this.collection.findOne({ _id: new ObjectId(id) }, { projection: { name: 1 } });

    if (!profile) {
      throw new NotFoundError("profile not found");
    }

    if (profile.name === "admin") {
      throw new Error("This admin account cannot be deleted");
    }
  }

  async delete(id: string): Promise<void> {
    await this.deleteUserValidation(id);
    await this.collection.deleteOne({ _id: new ObjectId(id) });
  }
}

export default ProfileService;
