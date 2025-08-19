import { Db, Collection, ObjectId, FindOptions } from "mongodb";
import { AppContext } from "../../../utils/helper.context";
import { BadRequestError, InternalServerError, NotFoundError, ValidationError } from "../../../utils/helper.errors";
import { validateObjectId } from "../../../utils/helper.mongo";
import ChatbotSettingService from "../../chatbot-settings/database/services";
import { ChatbotSettings } from "../../chatbot-settings/database/models";
import { LLMProvider } from "../../llm-provider/databases/models";
import globalEventBus from "../../../utils/helper.eventBus";
import { appendPaginationAndMetadata, filterFields, findWithOptions, parseFacetMetadata, QueryOptions, WithMetaData } from "../../../utils/helper";
import {
  CreateSectionContentData,
  GetAllBySectionRoomIdData,
  ReferenceRoleEnum,
  SectionContent,
  UpdateSectionContentData,
  UpdateSectionContentInputData,
} from "./model";
import { BaseService } from "../../core/base-service";
import { SectionRoom, SectionRoomStatusEnum } from "../../section-room/database/model";
import SectionRoomService from "../../section-room/database/service";

class SectionContentService extends BaseService {
  private db: Db;
  private collection: Collection<SectionContent>;
  public readonly collectionName = "section-contents";
  private chatbotSettingService: ChatbotSettingService;
  private sectionRoomService: SectionRoomService;
  private static readonly ALLOWED_UPDATE_FIELDS: ReadonlySet<keyof UpdateSectionContentData> = new Set(["markAsResult"] as const);

  constructor(context: AppContext) {
    super(context);
    this.db = context.mongoDatabase;
    this.collection = this.db.collection<SectionContent>(this.collectionName);
  }

  async init() {
    this.chatbotSettingService = this.getService("ChatbotSettingService");
    this.sectionRoomService = this.getService("SectionRoomService");
    // Ensure every sectionContent only have one sectionContentSetting
  }

  async create(data: CreateSectionContentData): Promise<SectionContent> {
    const { validatedData, sectionRoom, chatbotSetting } = await this.createValidation(data);
    const profileId = this.context.currentProfile?.id;
    if (!profileId) {
      throw new NotFoundError("User not found");
    }

    const newContent: SectionContent = {
      sectionRoomId: new ObjectId(validatedData.sectionRoomId),
      role: validatedData.role,
      input: validatedData.input,
      output: validatedData.output,
      previousResponseId: chatbotSetting.type == LLMProvider.OpenAI ? validatedData.previousResponseId : null,
      position: sectionRoom.sectionContentCount,
      markAsResult: false,
      inputTokens: validatedData.inputTokens ?? null,
      outputTokens: validatedData.outputTokens ?? null,
      generatedAt: validatedData.generatedAt ?? null,
    };
    const result = await this.collection.insertOne(newContent);
    if (!result) {
      throw new InternalServerError("Failed to craete sectionContent");
    }

    globalEventBus.emit("llm:sectionContentCreated", { _id: result.insertedId, ...newContent });
    console.log(`[SectionContentService] Emitted 'llm:sectionContentCreated' for ID: ${result.insertedId}`);
    return { _id: result.insertedId, ...newContent };
  }

  async update(sectionContentId: string, data: UpdateSectionContentData): Promise<SectionContent> {
    const filteredUpdateData = filterFields(data, SectionContentService.ALLOWED_UPDATE_FIELDS);
    const validatedData = await this.updateValidation(filteredUpdateData);
    const sectionContent: SectionContent | null = await this.getById(sectionContentId);
    if (!sectionContent) throw new NotFoundError("Section content not found");

    const updateData: Partial<SectionContent> = {
      ...validatedData,
    };

    const result = await this.collection.findOneAndUpdate({ _id: new ObjectId(sectionContentId) }, { $set: updateData }, { returnDocument: "after" });

    if (!result) throw new NotFoundError("Failed to update section");

    return result;
  }

  async delete(id: string): Promise<void> {
    await this.deleteValidation(id);
    const result = await this.collection.deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount <= 0) {
      throw new NotFoundError("Section content not found");
    }
  }

  async getAllBySectionRoomId(data: GetAllBySectionRoomIdData): Promise<WithMetaData<SectionContent>> {
    const { sectionRoom, validatedData } = await this.getAllBySectionRoomIdValidation(data);
    const { page = 1, limit = 10 } = validatedData;
    const pipeline = [{ $match: { sectionRoomId: sectionRoom._id } }, { $sort: { position: -1 } }];

    const paginatedPipeline = appendPaginationAndMetadata(pipeline, page, limit);
    const res = await this.collection.aggregate(paginatedPipeline).toArray();
    return parseFacetMetadata(res, page, limit);
  }

  async getAll(queryOptions: QueryOptions): Promise<WithMetaData<SectionContent>> {
    const options = {
      ...queryOptions,
      filter: {
        ...(queryOptions.filter || {}),
      },
    };
    return await findWithOptions(this.collection, options);
  }

  async getById(id: string): Promise<SectionContent | null> {
    validateObjectId(id);
    return await this.collection.findOne({ _id: new ObjectId(id) });
  }

  async findOne(filter: Partial<SectionContent>, options?: FindOptions<SectionContent>): Promise<SectionContent | null> {
    return await this.collection.findOne(filter, options);
  }

  async deleteValidation(id: string): Promise<void> {
    const sectionContent = await this.getById(id);
    if (!sectionContent) {
      throw new NotFoundError("Section content not found");
    }
  }

  private async updateValidation(data: UpdateSectionContentData): Promise<UpdateSectionContentData> {
    let { markAsResult } = data;
    if ("markAsResult" in data && typeof markAsResult !== "boolean") {
      throw new ValidationError("markAsResult must be a boolean");
    }

    return data;
  }

  private async createValidation(
    data: CreateSectionContentData
  ): Promise<{ validatedData: CreateSectionContentData; sectionRoom: SectionRoom; chatbotSetting: ChatbotSettings }> {
    const { sectionRoomId, role, input, output, previousResponseId, inputTokens, outputTokens, generatedAt } = data;
    console.log("data: ", data);
    let sectionRoom: SectionRoom | null = null;
    let chatbotSetting: ChatbotSettings | null = null;

    if (!sectionRoomId) {
      throw new NotFoundError('"sectionRoomId" field is required');
    }
    if (!role) {
      throw new NotFoundError('"role" field is required');
    }
    if (!input) {
      throw new NotFoundError('"input" field is required');
    }
    if (!output) {
      throw new NotFoundError('"output" field is required');
    }
    if (!inputTokens) {
      throw new NotFoundError('"inputTokens" field is required');
    }
    if (!outputTokens) {
      throw new NotFoundError('"outputTokens" field is required');
    }
    if (!generatedAt) {
      throw new NotFoundError('"generatedAt" field is required');
    }
    sectionRoom = await this.sectionRoomService.getById(sectionRoomId.toString());
    if (!sectionRoom) {
      throw new NotFoundError("Section Room not found");
    }
    if (!Object.values(ReferenceRoleEnum).includes(role)) {
      throw new ValidationError("Role provided is not supported");
    }
    if (typeof input !== "string" || !input.trim()) {
      throw new ValidationError("Input must be a non-empty string");
    }

    if (typeof output !== "string" || !output.trim()) {
      throw new ValidationError("Output must be a non-empty string");
    }

    if (typeof inputTokens !== "number" || inputTokens <= 0) {
      throw new ValidationError("inputTokens must be a number greater than 0");
    }

    if (typeof outputTokens !== "number" || outputTokens <= 0) {
      throw new ValidationError("outputTokens must be a number greater than 0");
    }
    chatbotSetting = await this.chatbotSettingService.getById(sectionRoom.chatbotSettingId.toString());
    if (!chatbotSetting) {
      throw new NotFoundError("Chatbot Setting not found");
    }
    return {
      validatedData: data,
      sectionRoom,
      chatbotSetting,
    };
  }

  private async getAllBySectionRoomIdValidation(
    data: GetAllBySectionRoomIdData
  ): Promise<{ validatedData: GetAllBySectionRoomIdData; sectionRoom: SectionRoom }> {
    const { sectionRoomId, page, limit } = data;
    let sectionRoom;

    if (!("sectionRoomId" in data)) {
      throw new BadRequestError('"sectionRoomId" field is required')
    }

    // If one of page/limit exists but not both → error
    if ((page !== undefined && limit === undefined) || (limit !== undefined && page === undefined)) {
      throw new BadRequestError('"page" and "limit" must both be provided together');
    }

    // If both are provided → must be numbers
    if (page !== undefined && limit !== undefined) {
      if (typeof page !== "number" || typeof limit !== "number") {
        throw new ValidationError('"page" and "limit" must be numbers');
      }
    }

    if (sectionRoomId) {
      validateObjectId(sectionRoomId);
      sectionRoom = await this.sectionRoomService.getById(sectionRoomId);
    }
    if (!sectionRoom) {
      throw new NotFoundError("Section Room not found");
    }

    return { validatedData: data, sectionRoom };
  }
}
export default SectionContentService;
