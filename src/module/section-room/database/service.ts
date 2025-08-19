import { Db, Collection, ObjectId, FindOptions } from "mongodb";
import { AppContext } from "../../../utils/helper.context";
import { validateObjectId, validateObjectIds } from "../../../utils/helper.mongo";
import { filterFields, findWithOptions, QueryOptions, WithMetaData } from "../../../utils/helper";
import {
  CreateSectionRoomData,
  InitSectionRoomData,
  SectionRoom,
  SectionRoomStatusEnum,
  UpdateDraftInputValidation,
  UpdateSectionRoomData,
} from "./model";
import { BaseService } from "../../core/base-service";
import SectionRoomSettingService from "../../section-room-setting/database/service";
import { SectionRoomSetting } from "../../section-room-setting/database/model";
import { BadRequestError, InternalServerError, NotFoundError, UnauthorizedError, ValidationError } from "../../../utils/helper.errors";
import ProfileService from "../../profiles/database/services";
import { ChatbotSettings } from "../../chatbot-settings/database/models";
import ChatbotSettingService from "../../chatbot-settings/database/services";
import globalEventBus from "../../../utils/helper.eventBus";
import { SectionContent } from "../../section-content/database/model";

class SectionRoomService extends BaseService {
  private db: Db;
  private collection: Collection<SectionRoom>;
  public readonly collectionName = "section-rooms";
  private sectionRoomService: SectionRoomService;
  private sectionRoomSettingService: SectionRoomSettingService;
  private profileService: ProfileService;
  private chatbotSettingService: ChatbotSettingService;
  private static readonly ALLOWED_UPDATE_FIELDS: ReadonlySet<keyof UpdateSectionRoomData> = new Set(["status", "errMsg"] as const);

  constructor(context: AppContext) {
    super(context);
    this.db = context.mongoDatabase;
    this.collection = this.db.collection<SectionRoom>(this.collectionName);
  }

  async init() {
    this.sectionRoomService = this.getService("SectionRoomService");
    this.sectionRoomSettingService = this.getService("SectionRoomSettingService");
    this.profileService = this.getService("ProfileService");
    this.chatbotSettingService = this.getService("ChatbotSettingService");
    this.collection.createIndex({ sectionRoomSettingId: 1, createdBy: 1 }, { unique: true });

    globalEventBus.on("llm:sectionContentCreated", async (event: SectionContent) => {
      if (!event || !event.sectionRoomId) {
        console.error("'sectionContentCreated' event or event id not found");
        return;
      }
      this.incrementSectionContentCount(event.sectionRoomId);
    });
    console.log('[SectionRoomService] Subscribed to "llm:sectionContentCreated" events.');
  }

  async initSectionRoom(sectionRoomId: string): Promise<InitSectionRoomData> {
    const sectionRoom = await this.sectionRoomService.getById(sectionRoomId);

    if (!sectionRoom) {
      throw new NotFoundError("Section room is not found");
    }
    const pipeline = [
      {
        $match: {
          _id: new ObjectId("689053bffe5b4e685848ee67"),
        },
      },
      {
        $lookup: {
          from: "section-room-setting",
          localField: "sectionRoomSettingId",
          foreignField: "_id",
          as: "sectionRoomSetting",
        },
      },
      {
        $unwind: {
          path: "$sectionRoomSetting",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $lookup: {
          from: "chatbot-settings",
          localField: "chatbotSettingId",
          foreignField: "_id",
          as: "chatbotSetting",
        },
      },
      {
        $unwind: {
          path: "$chatbotSetting",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          _id: 0,
          sectionRoom: {
            _id: "$_id",
            draftInput: "$draftInput",
            status: "$status",
            sectionContentCount: "$sectionContentCount",
            errMsg: "$errMsg",
            totalInputTokens: "$totalInputTokens",
            totalOutputTokens: "$totalOutputTokens",
          },
          sectionRoomSetting: {
            name: "$sectionRoomSetting.name",
            description: "$sectionRoomSetting.description",
          },
          chatbotSetting: {
            type: "$chatbotSetting.type",
            model: "$chatbotSetting.model",
          },
        },
      },
    ];
    const cursor = this.collection.aggregate<InitSectionRoomData>(pipeline);
    const res = await cursor.next();

    if (!res) {
      throw new NotFoundError("Section room data not found");
    }

    return res;
  }

  async create(data: CreateSectionRoomData): Promise<SectionRoom> {
    const { validatedData, sectionRoomSetting } = await this.createValidation(data);
    const profileId = this.context.currentProfile?.id;

    if (!profileId) {
      throw new NotFoundError("User not found");
    }

    console.log("sectionRoomSettingId:", validatedData.sectionRoomSettingId);

    const newSectionRoom: SectionRoom = {
      flowSettingId: new ObjectId(sectionRoomSetting.flowSettingId),
      sectionId: new ObjectId(sectionRoomSetting.sectionId),
      chatbotSettingId: new ObjectId(sectionRoomSetting.chatbotSettingId),
      sectionRoomSettingId: new ObjectId(validatedData.sectionRoomSettingId),
      draftInput: "",
      status: SectionRoomStatusEnum.pending,
      sectionContentCount: 0,
      errMsg: "",
      totalInputTokens: 0,
      totalOutputTokens: 0,
      createdAt: new Date(),
      updatedAt: null,
      createdBy: new ObjectId(profileId),
      updatedBy: null,
    };
    const result = await this.collection.insertOne(newSectionRoom);
    return { _id: result.insertedId, ...newSectionRoom };
  }

  async update(sectionRoomId: string, data: UpdateSectionRoomData): Promise<SectionRoom> {
    const filteredUpdateData = filterFields(data, SectionRoomService.ALLOWED_UPDATE_FIELDS);
    const validatedData = await this.updateValidation(filteredUpdateData);
    if (!sectionRoomId) throw new NotFoundError("Section content not found");

    const updateData: Partial<SectionRoom> = {
      ...validatedData,
    };

    const result = await this.collection.findOneAndUpdate({ _id: new ObjectId(sectionRoomId) }, { $set: updateData }, { returnDocument: "after" });

    if (!result) throw new NotFoundError("Failed to update section room");

    return result;
  }

  async updateTokenCost(sectionRoomId: string, inputTokens: number, outputTokens: number): Promise<SectionRoom> {
    const sectionRoom = await this.getById(sectionRoomId);
    if (!sectionRoom) {
      throw new NotFoundError("Section Room not found");
    }

    const updateData: Partial<SectionRoom> = {
      totalInputTokens: sectionRoom.totalInputTokens + inputTokens,
      totalOutputTokens: sectionRoom.totalOutputTokens + outputTokens,
    };

    const result = await this.collection.findOneAndUpdate({ _id: sectionRoom._id }, { $set: updateData }, { returnDocument: "after" });

    if (!result) throw new NotFoundError("Failed to update section room");

    return result;
  }

  async updateDraftInput(
    sectionRoomId: string,
    data: UpdateDraftInputValidation
  ): Promise<{
    chatbotSetting: ChatbotSettings;
    sectionRoom: SectionRoom;
    sectionRoomSetting: SectionRoomSetting;
  }> {
    const { validatedData, chatbotSetting, sectionRoom, sectionRoomSetting } = await this.updateDraftInputValidation(sectionRoomId, data);

    const updateData: Partial<SectionRoom> = {
      draftInput: validatedData.draftInput,
    };

    const result = await this.collection.findOneAndUpdate({ _id: new ObjectId(sectionRoomId) }, { $set: updateData }, { returnDocument: "after" });

    if (!result) throw new NotFoundError("Failed to update section");

    return { chatbotSetting, sectionRoom: result, sectionRoomSetting };
  }

  async delete(id: string): Promise<void> {
    await this.deleteValidation(id);
    const result = await this.collection.deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount <= 0) {
      throw new NotFoundError("Section content not found");
    }
  }

  async getAll(queryOptions: QueryOptions): Promise<WithMetaData<SectionRoom>> {
    const options = {
      ...queryOptions,
      filter: {
        ...(queryOptions.filter || {}),
      },
    };
    return await findWithOptions(this.collection, options);
  }

  async getById(id: string): Promise<SectionRoom | null> {
    validateObjectId(id);
    return await this.collection.findOne({ _id: new ObjectId(id) });
  }

  async findOne(filter: Partial<SectionRoom>, options?: FindOptions<SectionRoom>): Promise<SectionRoom | null> {
    return await this.collection.findOne(filter, options);
  }

  private async incrementSectionContentCount(sectionRoomId: ObjectId) {
    const result = await this.collection.findOneAndUpdate(
      { _id: new ObjectId(sectionRoomId) },
      { $inc: { sectionContentCount: 1 } },
      { returnDocument: "after" }
    );
    if (!result) {
      console.warn(`Section room with ID ${sectionRoomId} not found`);
      return;
    }
  }

  async deleteValidation(id: string): Promise<void> {
    const sectionContent = await this.getById(id);
    if (!sectionContent) {
      throw new NotFoundError("Section content not found");
    }
  }

  private async updateValidation(data: UpdateSectionRoomData): Promise<UpdateSectionRoomData> {
    let { status, errMsg } = data;
    if (!("status" in data) && !("errMsg" in data)) {
      throw new ValidationError("At least one field must be provided for update");
    }
    if ("status" in data) {
      if (!Object.values(SectionRoomStatusEnum).includes(status as SectionRoomStatusEnum)) {
        throw new ValidationError(`status must be one of ${Object.values(SectionRoomStatusEnum).join(", ")}`);
      }
    }
    if ("errMsg" in data && (typeof errMsg !== "string" || !errMsg.trim())) {
      throw new ValidationError("errMsg must be a non-empty string");
    }
    return data;
  }

  private async updateDraftInputValidation(
    sectionRoomId: string,
    data: UpdateDraftInputValidation
  ): Promise<{
    validatedData: UpdateDraftInputValidation;
    chatbotSetting: ChatbotSettings;
    sectionRoom: SectionRoom;
    sectionRoomSetting: SectionRoomSetting;
  }> {
    let { draftInput } = data;
    let chatbotSetting: ChatbotSettings | null = null;
    let sectionRoom: SectionRoom | null = null;
    let sectionRoomSetting: SectionRoomSetting | null = null;

    if (!sectionRoomId) {
      throw new BadRequestError("sectionRoomId is missing");
    }

    if ("draftInput" in data && (typeof draftInput !== "string" || !draftInput.trim())) {
      throw new ValidationError("draftInput must be a non-empty string");
    }

    sectionRoom = await this.getById(sectionRoomId);
    if (!sectionRoom) {
      throw new NotFoundError("sectionRoom not found");
    }

    if (!sectionRoom.sectionRoomSettingId) {
      throw new NotFoundError("sectionRoomSettingId not found in sectionRoom");
    }

    const [chatbotSettingData, sectionRoomSettingData] = await Promise.all([
      this.chatbotSettingService.getById(sectionRoom.chatbotSettingId.toString()),
      this.sectionRoomSettingService.getById(sectionRoom.sectionRoomSettingId.toString()),
    ]);

    chatbotSetting = chatbotSettingData;
    sectionRoomSetting = sectionRoomSettingData;

    if (!chatbotSetting) {
      throw new NotFoundError("chatbotSetting not found");
    }

    if (!sectionRoomSetting) {
      throw new NotFoundError("sectionRoomSetting not found");
    }

    return {
      validatedData: data,
      chatbotSetting,
      sectionRoom,
      sectionRoomSetting,
    };
  }

  private async createValidation(
    data: CreateSectionRoomData
  ): Promise<{ validatedData: CreateSectionRoomData; sectionRoomSetting: SectionRoomSetting }> {
    const { sectionRoomSettingId, createdBy } = data;
    let sectionRoomSetting: SectionRoomSetting | null = null;

    if (!sectionRoomSettingId) {
      throw new ValidationError('"sectionRoomSettingId" field is required');
    }

    if (!createdBy) {
      throw new ValidationError('"createdBy" field is required');
    }

    validateObjectIds([sectionRoomSettingId.toString(), createdBy.toString()]);

    const profile = this.profileService.getById(createdBy.toString());

    if (!profile) {
      throw new NotFoundError("Profile not found");
    }

    sectionRoomSetting = await this.sectionRoomSettingService.getById(sectionRoomSettingId.toString());
    if (!sectionRoomSetting) throw new NotFoundError("Section room setting not found");

    //! Add authorization checking, the section room is invited only

    const existing = await this.collection.findOne({
      sectionRoomSettingId: sectionRoomSetting._id,
      createdBy: new ObjectId(this.context.currentProfile?.id),
    });

    if (existing) {
      throw new ValidationError("You already have a SectionContent for this setting");
    }

    return {
      validatedData: data,
      sectionRoomSetting,
    };
  }
}

export default SectionRoomService;
