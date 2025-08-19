import { Collection, Db, ObjectId, Document } from "mongodb";
import { AppContext } from "../../../utils/helper.context";
import { CreateFlowSettingData, FlowSetting, FlowSettingWithSectionName, UpdateFlowSettingData } from "./models";
import { validateObjectId } from "../../../utils/helper.mongo";
import { appendPaginationAndMetadata, filterFields, findWithOptions, parseFacetMetadata, QueryOptions, WithMetaData } from "../../../utils/helper";
import ProfileService from "../../profiles/database/services";
import { NotFoundError, ValidationError } from "../../../utils/helper.errors";
import { BaseService } from "../../core/base-service";

class FlowSettingService extends BaseService {
  private db: Db;
  private collection: Collection<FlowSetting>;
  private readonly collectionName = "flow-settings";
  private profileService: ProfileService;
  private static readonly ALLOWED_UPDATE_FIELDS: ReadonlySet<keyof UpdateFlowSettingData> = new Set(["name"] as const);

  constructor(context: AppContext) {
    super(context);
    this.db = context.mongoDatabase;
    this.collection = this.db.collection<FlowSetting>(this.collectionName);
  }

  async init() {
    this.profileService = this.getService("ProfileService");
  }

  async create(data: CreateFlowSettingData): Promise<FlowSetting> {
    if (!this.context.currentProfile) {
      throw new Error("Current profile is not set");
    }
    const validatedData = await this.createValidation(data);
    const { name } = validatedData;

    const profileId = this.context.currentProfile.id;
    const newData: FlowSetting = {
      name: name.trim(),
      createdAt: new Date(),
      updatedAt: null,
      createdBy: new ObjectId(profileId),
      updatedBy: null,
    };

    const result = await this.collection.insertOne(newData);
    return { _id: result.insertedId, ...newData };
  }

  async update(id: string, data: Partial<UpdateFlowSettingData>): Promise<FlowSetting> {
    const setting = await this.getById(id);
    if (!setting) {
      throw new Error("Flow setting not found");
    }

    const filteredUpdateData = filterFields(data, FlowSettingService.ALLOWED_UPDATE_FIELDS);
    const validatedData = await this.updateValidation(filteredUpdateData);

    const updateData: Partial<FlowSetting> = {
      ...validatedData,
      updatedBy: new ObjectId(this.context.currentProfile?.id),
    };

    const updatedFlowSetting = await this.collection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: updateData, $currentDate: { updatedAt: true } },
      { returnDocument: "after" }
    );

    if (!updatedFlowSetting) {
      throw new Error("Failed to update flow setting");
    }

    return updatedFlowSetting;
  }

  async getBatch(ids: string[]): Promise<FlowSetting[]> {
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
      throw new ValidationError("Invalid request body. 'ids' must be an array of strings.");
    }
    const uniqueIds = [...new Set(ids)];

    // Validate and convert to ObjectId
    const objectIds = uniqueIds.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));

    if (objectIds.length === 0) return [];

    return this.collection.find({ _id: { $in: objectIds } }).toArray();
  }

  async getAllByProfileId(profileId: string): Promise<WithMetaData<FlowSetting>> {
    const profile = await this.profileService.getById(profileId);
    if (!profile) {
      throw new NotFoundError("Profile not found");
    }
    return await this.getAll({
      filter: { createdBy: profile._id },
    });
  }

  async getAllFlowSettingOptions(profileId: string): Promise<WithMetaData<FlowSetting>> {
    const profile = await this.profileService.getById(profileId);
    if (!profile) {
      throw new NotFoundError("Profile not found");
    }
    return await this.getAll({
      filter: { createdBy: profile._id },
      projection: {
        _id: 1,
        name: 1,
      },
    });
  }

  async getAllFlowSettingWithSectionName(profileId: string): Promise<WithMetaData<FlowSettingWithSectionName>> {
    const profile = await this.profileService.getById(profileId);
    if (!profile) {
      throw new NotFoundError("Profile not found");
    }

    const pipeline: Document[] = [
      { $match: { createdBy: profile._id } },

      {
        $lookup: {
          from: "sections",
          let: { flowId: "$_id" },
          pipeline: [{ $match: { $expr: { $eq: ["$flowSettingId", "$$flowId"] } } }, { $limit: 6 }],
          as: "sections",
        },
      },

      {
        $addFields: {
          hasMoreSections: { $gt: [{ $size: "$sections" }, 5] },
        },
      },

      {
        $project: {
          _id: 1,
          name: 1,
          hasMoreSections: 1,
          sections: {
            $map: {
              input: { $slice: ["$sections", 5] }, // only take first 5
              as: "section",
              in: {
                _id: "$$section._id",
                name: "$$section.name",
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

  async getAll(queryOptions: QueryOptions): Promise<WithMetaData<FlowSetting>> {
    const options = {
      ...queryOptions,
      filter: {
        ...(queryOptions.filter || {}),
      },
    };
    return await findWithOptions(this.collection, options);
  }

  private async createValidation(data: CreateFlowSettingData): Promise<CreateFlowSettingData> {
    const { name } = data;

    if (!("name" in data)) {
      throw new Error('"name" field is required');
    }

    if (typeof name !== "string" || !name.trim()) {
      throw new Error("name must be a non-empty string");
    }

    return data;
  }

  private async updateValidation(data: UpdateFlowSettingData): Promise<UpdateFlowSettingData> {
    const { name } = data;

    if (!("name" in data)) {
      throw new ValidationError("No valid fields provided for update");
    }

    if ("name" in data && (typeof name !== "string" || !name.trim())) {
      throw new ValidationError("name must be a non-empty string");
    }

    return data;
  }

  async getById(id: string): Promise<FlowSetting | null> {
    validateObjectId(id);
    return await this.collection.findOne({ _id: new ObjectId(id) });
  }
}

export default FlowSettingService;
