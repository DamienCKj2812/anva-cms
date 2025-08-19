import { Db, Collection, ObjectId, Document } from "mongodb";
import { AppContext } from "../../../utils/helper.context";
import { CreateSectionData, Section, SectionsWithSectionRoomSettingName, UpdateSectionData } from "./model";
import { NotFoundError, ValidationError } from "../../../utils/helper.errors";
import { validateObjectId, validateObjectIds } from "../../../utils/helper.mongo";
import FlowSettingService from "../../flow-settings/database/services";
import { FlowSetting } from "../../flow-settings/database/models";
import { appendPaginationAndMetadata, findWithOptions, parseFacetMetadata, QueryOptions, WithMetaData } from "../../../utils/helper";
import ProfileService from "../../profiles/database/services";
import { BaseService } from "../../core/base-service";
import globalEventBus, { SectionRoomCountUpdatedEvent } from "../../../utils/helper.eventBus";

class SectionService extends BaseService {
  private db: Db;
  private collection: Collection<Section>;
  private flowSettingService: FlowSettingService;
  private profileService: ProfileService;
  public readonly collectionName = "sections";

  constructor(context: AppContext) {
    super(context);
    this.db = context.mongoDatabase;
    this.collection = this.db.collection<Section>(this.collectionName);
  }

  async init() {
    this.flowSettingService = this.getService("FlowSettingService");
    this.profileService = this.getService("ProfileService");

    // Subscribe to event, for decrement and increment content count
    globalEventBus.on("section:sectionRoomSettingCountUpdated", async (event: SectionRoomCountUpdatedEvent) => {
      if (event.action === "increment") {
        await this.incrementSectionRoomSettingCount(event.sectionId);
      } else if (event.action === "decrement") {
        await this.decrementSectionRoomSettingCount(event.sectionId);
      }
    });

    console.log('[SectionService] Subscribed to "section:sectionRoomSettingCountUpdated" events.');
  }

  async create(data: CreateSectionData): Promise<Section> {
    if (!this.context.currentProfile) {
      throw new Error("Current profile is not set");
    }
    await this.createValidation(data);

    const profileId = this.context.currentProfile.id;
    const updateData: Section = {
      flowSettingId: new ObjectId(data.flowSettingId),
      name: data.name?.trim() || "",
      description: data.description?.trim() || "",
      sectionRoomSettingCount: 0,
      createdAt: new Date(),
      updatedAt: null,
      createdBy: new ObjectId(profileId),
      updatedBy: null,
    };

    const result = await this.collection.insertOne(updateData);

    return { _id: result.insertedId, ...updateData };
  }

  async update(id: string, data: Partial<UpdateSectionData>): Promise<Section> {
    const section = await this.getById(id);
    if (!section) {
      throw new Error("Section not found");
    }
    await this.updateValidation(data);
    const updateData: Partial<Section> = {
      ...data,
      flowSettingId: data.flowSettingId ? new ObjectId(data.flowSettingId) : section.flowSettingId,
      name: data.name?.trim() || section.name,
      description: data.description?.trim() || section.description,
      updatedAt: new Date(),
      updatedBy: this.context.currentProfile?.id ? new ObjectId(this.context.currentProfile.id) : null,
    };

    const result = await this.collection.findOneAndUpdate({ _id: new ObjectId(id) }, { $set: updateData }, { returnDocument: "after" });

    return result || section;
  }

  async delete(id: string): Promise<void> {
    await this.deleteValidation(id);
    const result = await this.collection.deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount <= 0) {
      throw new NotFoundError("Section not found");
    }
  }

  async getAllByFlowSettingId(flowSettingId: string): Promise<WithMetaData<Section>> {
    const flowSetting = await this.flowSettingService.getById(flowSettingId);
    if (!flowSetting) {
      throw new NotFoundError("Flow setting not found");
    }
    const options = {
      filter: { flowSettingId: flowSetting._id },
      sort: { createdAt: -1 } as const,
    };
    return await this.getAll(options);
  }

  async getAllByProfileId(profileId: string): Promise<WithMetaData<Section>> {
    const profile = await this.profileService.getById(profileId);
    if (!profile) {
      throw new NotFoundError("Flow setting not found");
    }
    const options = {
      filter: { createdBy: profile._id },
      sort: { createdAt: -1 } as const,
    };
    return await this.getAll(options);
  }

  async getAll(queryOptions: QueryOptions): Promise<WithMetaData<Section>> {
    const options = {
      ...queryOptions,
      filter: {
        ...(queryOptions.filter || {}),
      },
    };
    return await findWithOptions(this.collection, options);
  }

  async deleteValidation(id: string): Promise<void> {
    const section = await this.getById(id);
    if (!section) {
      throw new NotFoundError("Section not found");
    }
  }

  private async createValidation(data: CreateSectionData) {
    const { flowSettingId, name, description } = data;
    if (!("flowSettingId" in data)) {
      throw new ValidationError('"flowSettingId" field is required');
    }
    if (!("name" in data)) {
      throw new ValidationError('"name" field is required');
    }
    if (!("description" in data)) {
      throw new ValidationError('"description" field is required');
    }

    if (flowSettingId) {
      if (typeof flowSettingId !== "string" || !ObjectId.isValid(flowSettingId)) {
        throw new ValidationError("flowSettingId must be a valid ObjectId string");
      }
      validateObjectId(flowSettingId);
      const currentFlowSetting: FlowSetting | null = await this.flowSettingService.getById(flowSettingId);
      if (!currentFlowSetting) {
        throw new ValidationError("Flow setting not found");
      }
    }

    if (typeof name !== "string" || !name.trim()) {
      throw new ValidationError("name must be a non-empty string");
    }
    if (typeof description !== "string") {
      throw new ValidationError("description must be a string");
    }
  }

  private async updateValidation(data: Partial<UpdateSectionData>) {
    const { flowSettingId, name, description } = data;
    if (!("flowSettingId" in data) && !("name" in data) && !("description" in data)) {
      throw new ValidationError("Missing required fields");
    }

    if ("flowSettingId" in data) {
      if (typeof flowSettingId !== "string" || !flowSettingId.trim()) {
        throw new ValidationError("flowSettingId must be a valid ObjectId string");
      }
      validateObjectId(flowSettingId);
      const currentFlowSetting: FlowSetting | null = await this.flowSettingService.getById(flowSettingId);
      if (!currentFlowSetting) {
        throw new ValidationError("Flow setting not found");
      }
    }

    if (name && (typeof name !== "string" || !name.trim())) {
      throw new ValidationError("name must be a non-empty string");
    }
    if (description && typeof description !== "string") {
      throw new ValidationError("description must be a string");
    }
  }

  async getById(id: string): Promise<Section | null> {
    validateObjectId(id);
    return await this.collection.findOne({ _id: new ObjectId(id) });
  }

  async getAllSectionOptions(profileId: string): Promise<WithMetaData<Section>> {
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

  async getSectionsWithRoomSettings(flowSettingId: string): Promise<WithMetaData<SectionsWithSectionRoomSettingName>> {
    const flowSetting = await this.flowSettingService.getById(flowSettingId);
    if (!flowSetting) {
      throw new NotFoundError("Profile not found");
    }

    const pipeline: Document[] = [
      { $match: { flowSettingId: flowSetting._id } },

      {
        $lookup: {
          from: "section-room-setting",
          let: { sectionId: "$_id" },
          pipeline: [{ $match: { $expr: { $eq: ["$sectionId", "$$sectionId"] } } }, { $limit: 6 }],
          as: "sectionRoomSettings",
        },
      },

      {
        $addFields: {
          hasMoreSectionRoomSettings: { $gt: [{ $size: "$sectionRoomSettings" }, 5] },
        },
      },

      {
        $project: {
          _id: 1,
          flowSettingId: 1,
          name: 1,
          description: 1,
          hasMoreSectionRoomSettings: 1,
          sectionRoomSettings: {
            $map: {
              input: { $slice: ["$sectionRoomSettings", 5] }, // only take first 5
              as: "s",
              in: {
                _id: "$$s._id",
                name: "$$s.name",
              },
            },
          },
        },
      },
    ];

    const paginatedPipeline = appendPaginationAndMetadata(pipeline, 1, 20);
    const res = await this.collection.aggregate(paginatedPipeline).toArray();
    return parseFacetMetadata(res, 1, 20);
  }

  async incrementSectionRoomSettingCount(sectionId: string): Promise<Section> {
    const result = await this.collection.findOneAndUpdate(
      { _id: new ObjectId(sectionId) },
      { $inc: { sectionRoomSettingCount: 1 } },
      { returnDocument: "after" }
    );
    if (!result) {
      throw new NotFoundError(`Section with ID ${sectionId} not found`);
    }

    return result;
  }
  async decrementSectionRoomSettingCount(sectionId: string): Promise<Section> {
    const result = await this.collection.findOneAndUpdate(
      { _id: new ObjectId(sectionId) },
      { $inc: { sectionRoomSettingCount: -1 }, $currentDate: { updatedAt: true } },
      { returnDocument: "after" }
    );

    if (!result) {
      throw new NotFoundError(`Section with ID ${sectionId} not found`);
    }

    return result;
  }
}

export default SectionService;
