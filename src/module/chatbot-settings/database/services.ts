import { Collection, Db, FindOptions, ObjectId } from "mongodb";
import { AppContext } from "../../../utils/helper.context";
import { ChatbotSettings, ChatbotSettingsUpdateData, CreateChatbotSettingsData } from "./models";
import { validateObjectId } from "../../../utils/helper.mongo";
import { BadRequestError, NotFoundError, ValidationError } from "../../../utils/helper.errors";
import { ChatbotModelMap } from "../../llm-provider/databases/models";
import SectionRoomSettingService from "../../section-room-setting/database/service";
import { BaseService } from "../../core/base-service";
import { findWithOptions, QueryOptions, WithMetaData } from "../../../utils/helper";
import ProfileService from "../../profiles/database/services";
import { Section } from "../../section/database/model";

class ChatbotSettingService extends BaseService {
  private db: Db;
  private collection: Collection<ChatbotSettings>;
  private sectionRoomSettingService: SectionRoomSettingService;
  private profileService: ProfileService;
  public readonly collectionName = "chatbot-settings";

  constructor(context: AppContext) {
    super(context);
    this.db = context.mongoDatabase;
    this.collection = this.db.collection<ChatbotSettings>(this.collectionName);
  }

  async init() {
    this.sectionRoomSettingService = this.getService("SectionRoomSettingService");
    this.profileService = this.getService("ProfileService");
  }

  async create(data: CreateChatbotSettingsData): Promise<ChatbotSettings> {
    if (!this.context.currentProfile) {
      throw new BadRequestError("Current profile is not set");
    }

    const profileId = this.context.currentProfile.id;
    const validatedData = await this.createValidation(data);

    const updateData: ChatbotSettings = {
      name: validatedData.name!,
      token: validatedData.token!,
      type: validatedData.type!,
      model: validatedData.model!,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: new ObjectId(profileId),
      updatedBy: null,
    };

    const result = await this.collection.insertOne(updateData);

    return { _id: result.insertedId, ...updateData };
  }

  async update(id: string, data: ChatbotSettingsUpdateData) {
    const setting = await this.getById(id);
    if (!setting) {
      throw new Error("Chatbot settings not found");
    }

    const validatedData = await this.updateValidation(data);
    const updateData: Partial<ChatbotSettings> = {
      ...validatedData,
      updatedAt: new Date(),
      updatedBy: this.context.currentProfile?.id ? new ObjectId(this.context.currentProfile.id) : null,
    };

    const result = await this.collection.findOneAndUpdate({ _id: new ObjectId(id) }, { $set: updateData }, { returnDocument: "after" });

    if (!result) {
      throw new Error("Failed to update chatbot settings");
    }

    return updateData;
  }

  async delete(id: string): Promise<ChatbotSettings> {
    const chatbotSetting = await this.getById(id);
    if (!chatbotSetting) {
      throw new NotFoundError("Chatbot Setting not found");
    }

    const sectionRoomSetting = await this.sectionRoomSettingService.findOne({ chatbotSettingId: chatbotSetting._id, isDeleted: false });
    if (sectionRoomSetting) {
      throw new ValidationError("This setting still used by other section room setting");
    }

    const deleted = await this.collection.findOneAndDelete({ _id: chatbotSetting._id });
    if (!deleted) throw new Error("Failed to delete the chatbot setting");

    return deleted;
  }

  async createValidation(data: ChatbotSettingsUpdateData): Promise<ChatbotSettingsUpdateData> {
    const { name, token, type, model } = data;

    if (!("name" in data)) {
      throw new BadRequestError('"name" is required for create');
    }
    if (!("token" in data)) {
      throw new BadRequestError('"token" is required for create');
    }
    if (!("type" in data)) {
      throw new BadRequestError('"type" is required for create');
    }
    if (!("model" in data)) {
      throw new BadRequestError('"model" is required for create');
    }
    if (typeof name !== "string" || !name.trim()) {
      throw new ValidationError("name must be a non-empty string");
    }
    if (typeof token !== "string" || !token.trim()) {
      throw new ValidationError("token must be a non-empty string");
    }

    const hasType = "type" in data;
    const hasModel = "model" in data;

    if (hasType && !hasModel) {
      throw new BadRequestError("model is required when type is provided");
    }
    if (!hasType && hasModel) {
      throw new BadRequestError("type is required when model is provided");
    }

    // Validate type + model
    if (hasType && hasModel) {
      if (typeof type !== "string" || !type.trim()) {
        throw new ValidationError("type must be a non-empty string");
      }
      if (typeof model !== "string" || !model.trim()) {
        throw new ValidationError("model must be a non-empty string");
      }
      if (!ChatbotModelMap[type]?.includes(model)) {
        throw new ValidationError(`Invalid model "${model}" for type "${type}"`);
      }
    }

    return data;
  }

  // Currently, this is same as createValidation, but can be extended later
  async updateValidation(data: ChatbotSettingsUpdateData): Promise<ChatbotSettingsUpdateData> {
    const { name, token, type, model } = data;

    if (!("name" in data) && !("token" in data) && !("type" in data) && !("model" in data)) {
      throw new BadRequestError("No valid fields provided for update");
    }
    if ("name" in data) {
      if (typeof name !== "string" || !name.trim()) {
        throw new ValidationError("name must be a non-empty string");
      }
    }
    if ("token" in data) {
      if (typeof token !== "string" || !token.trim()) {
        throw new ValidationError("token must be a non-empty string");
      }
    }

    const hasType = "type" in data;
    const hasModel = "model" in data;

    if (hasType && !hasModel) {
      throw new BadRequestError("model is required when type is provided");
    }
    if (!hasType && hasModel) {
      throw new BadRequestError("type is required when model is provided");
    }

    // Validate type + model
    if (hasType && hasModel) {
      if (typeof type !== "string" || !type.trim()) {
        throw new ValidationError("type must be a non-empty string");
      }
      if (typeof model !== "string" || !model.trim()) {
        throw new ValidationError("model must be a non-empty string");
      }
      if (!ChatbotModelMap[type]?.includes(model)) {
        throw new ValidationError(`Invalid model "${model}" for type "${type}"`);
      }
    }

    return data;
  }

  async findOne(filter: Partial<ChatbotSettings>, options?: FindOptions<ChatbotSettings>): Promise<ChatbotSettings | null> {
    return this.collection.findOne(filter, options);
  }

  async getById(id: string): Promise<ChatbotSettings> {
    validateObjectId(new ObjectId(id));
    const setting = await this.collection.findOne({ _id: new ObjectId(id) });

    if (!setting) {
      throw new NotFoundError("Chatbot setting not found");
    }

    return setting;
  }

  async getChatbotSettingsByProfileId(profileId: string): Promise<WithMetaData<ChatbotSettings>> {
    const profile = await this.profileService.getById(profileId);
    if (!profile) {
      throw new NotFoundError("Profile not found");
    }
    return this.getAll({
      filter: {
        createdBy: profile._id,
      },
      sort: {
        updatedAy: -1,
      },
    });
  }

  async getChatbotSettingOptions(profileId: string): Promise<WithMetaData<ChatbotSettings>> {
    const profile = await this.profileService.getById(profileId);
    if (!profile) {
      throw new NotFoundError("Profile not found");
    }
    return this.getAll({
      filter: {
        createdBy: profile._id,
      },
      projection: {
        _id: 1,
        name: 1,
      },
    });
  }

  async getAll(queryOptions: QueryOptions): Promise<WithMetaData<ChatbotSettings>> {
    const options = {
      ...queryOptions,
      filter: {
        ...(queryOptions.filter || {}),
      },
    };
    return await findWithOptions(this.collection, options);
  }

  async getBatch(ids: string[]): Promise<ChatbotSettings[]> {
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
      throw new ValidationError("Invalid request body. 'ids' must be an array of strings.");
    }
    const uniqueIds = [...new Set(ids)];

    // Validate and convert to ObjectId
    const objectIds = uniqueIds.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));

    if (objectIds.length === 0) return [];

    return this.collection.find({ _id: { $in: objectIds } }).toArray();
  }
}

export default ChatbotSettingService;
