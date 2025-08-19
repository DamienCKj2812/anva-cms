import { Collection, Db, FindOptions, ObjectId, Document } from "mongodb";
import { AppContext } from "../../../utils/helper.context";
import { validateObjectId, validateObjectIds } from "../../../utils/helper.mongo";
import { appendPaginationAndMetadata, filterFields, findWithOptions, parseFacetMetadata, QueryOptions, WithMetaData } from "../../../utils/helper";
import { BadRequestError, ForbiddenError, NotFoundError, ValidationError } from "../../../utils/helper.errors";
import {
  AddReferenceData,
  CreateSectionContentSettingData,
  Reference,
  SectionRoomSetting,
  SectionRoomSettingWithReferences,
  UpdateFullReferenceList,
  UpdatePositionData,
  UpdateSectionRoomSetting,
} from "./model";
import FlowSettingService from "../../flow-settings/database/services";
import SectionService from "../../section/database/services";
import ChatbotSettingService from "../../chatbot-settings/database/services";
import { BaseService } from "../../core/base-service";
import globalEventBus from "../../../utils/helper.eventBus";
import { ChatbotSettings } from "../../chatbot-settings/database/models";
import { Section } from "../../section/database/model";

class SectionRoomSettingService extends BaseService {
  private db: Db;
  private collection: Collection<SectionRoomSetting>;
  private readonly collectionName = "section-room-setting";
  private flowSettingService: FlowSettingService;
  private sectionService: SectionService;
  private chatbotSettingService: ChatbotSettingService;
  private static readonly ALLOWED_UPDATE_FIELDS: ReadonlySet<keyof UpdateSectionRoomSetting> = new Set([
    "sectionId",
    "chatbotSettingId",
    "systemPrompt",
    "name",
    "description",
  ] as const);

  constructor(context: AppContext) {
    super(context);
    this.db = context.mongoDatabase;
    this.collection = this.db.collection<SectionRoomSetting>(this.collectionName);
  }

  public init() {
    this.flowSettingService = this.getService("FlowSettingService");
    this.sectionService = this.getService("SectionService");
    this.chatbotSettingService = this.getService("ChatbotSettingService");
  }

  async create(data: CreateSectionContentSettingData): Promise<SectionRoomSetting> {
    if (!this.context.currentProfile) {
      throw new Error("Current profile is not set");
    }

    const { validatedData, section } = await this.createValidation(data);
    if (!section?._id) throw new NotFoundError("section not found");
    const { chatbotSettingId, name, description } = validatedData;
    const profileId = this.context.currentProfile.id;

    if (!section?.flowSettingId) throw new ValidationError("Section flowsetting is not set");

    const newData: SectionRoomSetting = {
      flowSettingId: section.flowSettingId,
      sectionId: section._id,
      chatbotSettingId: new ObjectId(chatbotSettingId),
      systemPrompt: validatedData.systemPrompt,
      references: [],
      name: name?.trim(),
      description,
      position: section.sectionRoomSettingCount,
      isDeleted: false,
      createdAt: new Date(),
      updatedAt: null,
      createdBy: new ObjectId(profileId),
      updatedBy: null,
    };

    const result = await this.collection.insertOne(newData);

    // Emit event to increment count for the section
    globalEventBus.emit("section:sectionRoomSettingCountUpdated", {
      sectionId: section._id.toString(),
      action: "increment",
    });

    console.log("[SectionRoomSettingService] Subscribe to 'sectionRoomSettingCountUpdated' event");
    return { _id: result.insertedId, ...newData };
  }

  async update(id: string, data: UpdateSectionRoomSetting): Promise<SectionRoomSetting> {
    const currentSectionRoomSetting = await this.getById(id);
    if (!currentSectionRoomSetting) throw new NotFoundError("Section room setting not found");

    const filteredUpdateData = filterFields(data, SectionRoomSettingService.ALLOWED_UPDATE_FIELDS);
    const { validatedData, targetSection } = await this.updateValidation(filteredUpdateData);

    if (!targetSection?._id) throw new NotFoundError("Target Section not found");
    const isSectionChanged = !targetSection?._id.equals(currentSectionRoomSetting.sectionId);

    const updateData: Partial<SectionRoomSetting> = {
      ...validatedData,
      flowSettingId: targetSection?.flowSettingId,
      sectionId: validatedData.sectionId ? new ObjectId(validatedData.sectionId) : currentSectionRoomSetting.sectionId,
      chatbotSettingId: validatedData.chatbotSettingId ? new ObjectId(validatedData.chatbotSettingId) : currentSectionRoomSetting.chatbotSettingId,
      position: isSectionChanged ? targetSection.sectionRoomSettingCount : currentSectionRoomSetting.position,
      updatedBy: new ObjectId(this.context.currentProfile?.id),
    };

    const updatedSectionRoomSetting = await this.collection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: updateData, $currentDate: { updatedAt: true } },
      { returnDocument: "after" }
    );

    if (isSectionChanged) {
      // Adjust positions in the old section
      await this.collection.updateMany(
        { sectionId: currentSectionRoomSetting.sectionId, position: { $gt: currentSectionRoomSetting.position } },
        { $inc: { position: -1 } }
      );

      // Increment new section count and get the updated section
      await this.sectionService.incrementSectionRoomSettingCount(targetSection._id.toString());
      // Decrement old section count
      await this.sectionService.decrementSectionRoomSettingCount(currentSectionRoomSetting.sectionId.toString());
    }

    if (!updatedSectionRoomSetting) {
      throw new Error("Failed to update section room setting");
    }

    return updatedSectionRoomSetting;
  }

  async addReferences(sectionContentId: string, reference: AddReferenceData): Promise<Reference> {
    const { validatedReference, sectionRoomSetting } = await this.addReferenceValidation(sectionContentId, reference);

    const newReference: Reference[] = [
      ...(sectionRoomSetting.references || []),
      {
        sectionRoomSettingId: new ObjectId(validatedReference.sectionRoomSettingId),
      },
    ];

    const updateData: Partial<SectionRoomSetting> = {
      references: newReference,
      updatedAt: new Date(),
    };

    const result = await this.collection.findOneAndUpdate({ _id: new ObjectId(sectionContentId) }, { $set: updateData }, { returnDocument: "after" });

    if (!result) {
      throw new NotFoundError("Failed to update section with chatbot history");
    }

    return newReference[newReference.length - 1];
  }

  async updateFullReferencesList(sectionContentId: string, updateFullReferenceList: UpdateFullReferenceList): Promise<SectionRoomSetting> {
    const { validatedReferences, sectionRoomSetting } = await this.addReferencesValidationArray(sectionContentId, updateFullReferenceList);

    const updateData: Partial<SectionRoomSetting> = {
      references: validatedReferences,
      updatedAt: new Date(),
    };

    const result = await this.collection.findOneAndUpdate({ _id: new ObjectId(sectionContentId) }, { $set: updateData }, { returnDocument: "after" });

    if (!result) {
      throw new NotFoundError("Failed to update section with references");
    }

    return result;
  }

  async updatePosition(data: UpdatePositionData): Promise<boolean> {
    const validatedData = await this.updatePositionValidation(data);
    const bulkOps = validatedData.idsOrder.map((id, index) => ({
      updateOne: {
        filter: { _id: new ObjectId(id) },
        update: { $set: { position: index } },
      },
    }));
    const res = await this.collection.bulkWrite(bulkOps);

    if (res.hasWriteErrors()) {
      throw new Error("Failed to update some positions");
    }

    return true;
  }

  async updatePositionValidation(data: UpdatePositionData): Promise<UpdatePositionData> {
    const { sectionId, idsOrder } = data;

    if (!sectionId) throw new ValidationError('"sectionId" field is required');
    if (!idsOrder || !Array.isArray(idsOrder)) {
      throw new ValidationError('"idsOrder" must be a non-empty array');
    }
    if (idsOrder.length === 0) {
      throw new BadRequestError('"idsOrder" cannot be an empty array');
    }

    // Check section existence & ownership
    const section = await this.sectionService.getById(sectionId);
    if (!section) throw new NotFoundError("Section not found");
    if (!section?.createdBy?.equals(new ObjectId(this.context.currentProfile?.id))) {
      throw new ForbiddenError("You are not authorized to access this resource");
    }

    const objectIds = idsOrder.map((id) => {
      if (typeof id !== "string" || !id.trim()) {
        throw new ValidationError("Each ID in idsOrder must be a non-empty string");
      }
      return new ObjectId(id);
    });

    // Get all existing IDs in this section
    const existingDocs = await this.collection
      .find({ sectionId: new ObjectId(sectionId) })
      .project({ _id: 1 })
      .toArray();

    const existingIdsSet = new Set(existingDocs.map((doc) => doc._id.toString()));
    const requestedIdsSet = new Set(idsOrder);

    // Ensure requested IDs match exactly the IDs in the section
    if (existingIdsSet.size !== requestedIdsSet.size || ![...requestedIdsSet].every((id) => existingIdsSet.has(id))) {
      throw new ValidationError("Some sectionContentSettings do not exist or do not belong to this section");
    }

    return data;
  }

  private async createValidation(
    data: CreateSectionContentSettingData
  ): Promise<{ validatedData: CreateSectionContentSettingData; chatbotSetting?: ChatbotSettings; section?: Section }> {
    const { chatbotSettingId, sectionId, systemPrompt, name, description } = data;
    const userId = new ObjectId(this.context.currentProfile?.id);

    if (!chatbotSettingId) throw new Error('"chatbotSettingId" field is required');
    if (!sectionId) throw new Error('"sectionId" field is required');
    if (!systemPrompt) throw new Error('"systemPrompt field is required"');
    if (!name) throw new Error('"name" field is required');
    if (!description) throw new Error('"description" field is required');

    validateObjectIds([chatbotSettingId.toString(), sectionId.toString()]);

    const [chatbotSetting, section] = await Promise.all([
      this.chatbotSettingService.getById(chatbotSettingId.toString()),
      this.sectionService.getById(sectionId.toString()),
    ]);

    if (!chatbotSetting) throw new NotFoundError("chatbotSetting not found");
    if (!section) throw new NotFoundError("section not found");

    if (!(chatbotSetting.createdBy?.equals(userId) && section.createdBy?.equals(userId))) {
      throw new ValidationError("You are not authorized to use this resource");
    }
    if (typeof systemPrompt !== "string" || !systemPrompt.trim()) throw new Error("systemPrompt must be a non-empty string");
    if (typeof name !== "string" || !name.trim()) throw new Error("name must be a non-empty string");
    if (typeof description !== "string" || !description.trim()) throw new Error("description must be a non-empty string");

    return { validatedData: data, chatbotSetting, section };
  }

  private async updateValidation(
    data: UpdateSectionRoomSetting
  ): Promise<{ validatedData: UpdateSectionRoomSetting; chatbotSetting?: ChatbotSettings; targetSection?: Section }> {
    const { sectionId, chatbotSettingId, name, description } = data;
    const userId = new ObjectId(this.context.currentProfile?.id);

    if (!("sectionId" in data) && !("chatbotSettingId" in data) && !("name" in data) && !("description" in data)) {
      throw new ValidationError("No valid fields provided for update");
    }

    const [section, chatbotSetting] = await Promise.all([
      sectionId ? this.sectionService.getById(sectionId) : Promise.resolve(null),
      chatbotSettingId ? this.chatbotSettingService.getById(chatbotSettingId) : Promise.resolve(null),
    ]);

    if (sectionId && !section) throw new NotFoundError("Section not found");
    if (chatbotSettingId && !chatbotSetting) throw new NotFoundError("Chatbot Setting not found");

    if (section && !section.createdBy?.equals(userId)) {
      throw new ValidationError("You are not authorized to update this section");
    }
    if (chatbotSetting && !chatbotSetting.createdBy?.equals(userId)) {
      throw new ValidationError("You are not authorized to update this chatbot setting");
    }

    if ("name" in data && (typeof name !== "string" || !name.trim())) {
      throw new ValidationError("Name must be a non-empty string");
    }
    if ("description" in data && (typeof description !== "string" || !description.trim())) {
      throw new ValidationError("Description must be a non-empty string");
    }

    return { validatedData: data, chatbotSetting: chatbotSetting || undefined, targetSection: section || undefined };
  }

  async getById(id: string): Promise<SectionRoomSetting | null> {
    validateObjectId(id);
    return await this.collection.findOne({ _id: new ObjectId(id) });
  }

  async findOne(filter: Partial<SectionRoomSetting>, options?: FindOptions<SectionRoomSetting>): Promise<SectionRoomSetting | null> {
    return await this.collection.findOne(filter, options);
  }

  async getByChatbotSettingId(chatbotSettingId: string): Promise<SectionRoomSetting | null> {
    validateObjectId(chatbotSettingId);
    return await this.collection.findOne({ chatbotSettingId: new ObjectId(chatbotSettingId) });
  }

  async getAllBySectionId(sectionId: string): Promise<WithMetaData<SectionRoomSetting>> {
    const section = await this.sectionService.getById(sectionId);
    if (!section) {
      throw new NotFoundError("Section not found");
    }
    const options = {
      filter: { sectionId: section._id },
      sort: { position: 1 } as const,
    };
    return await this.getAll(options);
  }

  async getAll(queryOptions: QueryOptions): Promise<WithMetaData<SectionRoomSetting>> {
    const options = {
      ...queryOptions,
      filter: {
        ...(queryOptions.filter || {}),
      },
    };
    return await findWithOptions(this.collection, options);
  }

  async getAllWithReferencesBySectionId(sectionId: string): Promise<WithMetaData<SectionRoomSettingWithReferences>> {
    const section = await this.sectionService.getById(sectionId);
    if (!section || !section.createdBy) {
      throw new NotFoundError("Section Room Setting not found");
    }
    if (!section.createdBy.equals(this.context.currentProfile?.id)) {
      throw new ForbiddenError("User are not authorized to get this resources");
    }

    const pipeline = [
      { $match: { sectionId: section._id } },
      { $unwind: { path: "$references", preserveNullAndEmptyArrays: true, includeArrayIndex: "order" } },
      {
        $lookup: {
          from: "section-room-setting",
          let: { refId: "$references.sectionRoomSettingId" },
          pipeline: [
            {
              $match: { $expr: { $eq: ["$_id", "$$refId"] } },
            },
            { $project: { _id: 1, name: 1 } },
          ],
          as: "referencesDetails",
        },
      },
      { $unwind: { path: "$referencesDetails", preserveNullAndEmptyArrays: true } },
      { $sort: { order: 1 } },
      {
        $group: {
          _id: "$_id",
          references: { $push: "$references" },
          referencesDetails: { $push: "$referencesDetails" },
          flowSettingId: { $first: "$flowSettingId" },
          sectionId: { $first: "$sectionId" },
          chatbotSettingId: { $first: "$chatbotSettingId" },
          systemPrompt: { $first: "$systemPrompt" },
          name: { $first: "$name" },
          description: { $first: "$description" },
          position: { $first: "$position" },
          isDeleted: { $first: "$isDeleted" },
          createdAt: { $first: "$createdAt" },
          updatedAt: { $first: "$updatedAt" },
          createdBy: { $first: "$createdBy" },
          updatedBy: { $first: "$updatedBy" },
        },
      },
      {
        $addFields: {
          hasMoreReferencesDetails: {
            $gt: [{ $size: "$referencesDetails" }, 10],
          },
        },
      },
    ];
    const paginatedPipeline = appendPaginationAndMetadata(pipeline, 1, 20);
    const res = await this.collection.aggregate(paginatedPipeline).toArray();
    return parseFacetMetadata(res, 1, 20);
  }

  async getWithReferences(sectionRoomSettingId: string): Promise<WithMetaData<SectionRoomSettingWithReferences>> {
    const sectionRoomSetting = await this.getById(sectionRoomSettingId);
    if (!sectionRoomSetting || !sectionRoomSetting.createdBy) {
      throw new NotFoundError("Section Room Setting not found");
    }
    if (!sectionRoomSetting.createdBy.equals(this.context.currentProfile?.id)) {
      throw new ForbiddenError("User are not authorized is check setting");
    }

    const pipeline = [
      { $match: { _id: sectionRoomSetting._id } },
      // Break references into individual items and keep their index
      { $unwind: { path: "$references", includeArrayIndex: "order" } },
      {
        $lookup: {
          from: "section-room-setting",
          let: { refId: "$references.sectionRoomSettingId" },
          pipeline: [{ $match: { $expr: { $eq: ["$_id", "$$refId"] } } }, { $project: { _id: 1, name: 1 } }],
          as: "referencesDetails",
        },
      },
      // Since lookup returns an array, unwind it (expect exactly one match)
      { $unwind: "$referencesDetails" },
      // Restore original array order
      { $sort: { order: 1 } },
      // Group back into one document, preserving order in both arrays
      {
        $group: {
          _id: "$_id",
          // Collect back the ordered references
          references: { $push: "$references" },
          // Collect the ordered details
          referencesDetails: { $push: "$referencesDetails" },
          // Preserve all other top-level fields from the original document
          flowSettingId: { $first: "$flowSettingId" },
          sectionId: { $first: "$sectionId" },
          chatbotSettingId: { $first: "$chatbotSettingId" },
          systemPrompt: { $first: "$systemPrompt" },
          name: { $first: "$name" },
          description: { $first: "$description" },
          position: { $first: "$position" },
          isDeleted: { $first: "$isDeleted" },
          createdAt: { $first: "$createdAt" },
          updatedAt: { $first: "$updatedAt" },
          createdBy: { $first: "$createdBy" },
          updatedBy: { $first: "$updatedBy" },
        },
      },
    ];

    const paginatedPipeline = appendPaginationAndMetadata(pipeline, 1, 20);
    const res = await this.collection.aggregate(paginatedPipeline).toArray();
    return parseFacetMetadata(res, 1, 20);
  }

  private async addReferenceValidation(
    targetSectionRoomSettingId: string,
    data: AddReferenceData
  ): Promise<{
    validatedReference: AddReferenceData;
    sectionRoomSetting: SectionRoomSetting;
  }> {
    const { sectionRoomSettingId } = data;
    const userId = new ObjectId(this.context.currentProfile?.id);

    const targetSectionRoomSetting = await this.getById(targetSectionRoomSettingId);
    if (!targetSectionRoomSetting) {
      throw new NotFoundError("Section Room Setting not found");
    }

    if (!targetSectionRoomSetting.createdBy?.equals(userId)) {
      throw new ForbiddenError("Unable to access to this content section setting");
    }

    if (!sectionRoomSettingId) {
      throw new BadRequestError("'sectionRoomSettingId' is required");
    }

    if (new ObjectId(targetSectionRoomSettingId).equals(new ObjectId(sectionRoomSettingId))) {
      throw new BadRequestError("Reference cannot be current section room");
    }

    // Target-based default reference
    if (sectionRoomSettingId) {
      // Ensure target SectionContentSetting exists
      const referenceSectionRoomSetting = await this.getById(sectionRoomSettingId);
      if (!referenceSectionRoomSetting) {
        throw new NotFoundError(`Target SectionRoomSetting with ID ${sectionRoomSettingId} not found`);
      }
      if (!referenceSectionRoomSetting.createdBy?.equals(userId)) {
        throw new ForbiddenError("Unable to reference to this content section setting");
      }
      if (targetSectionRoomSetting.references.some((r) => r.sectionRoomSettingId.equals(referenceSectionRoomSetting._id))) {
        throw new ValidationError("References is already exists");
      }
      if (
        referenceSectionRoomSetting.sectionId.equals(targetSectionRoomSetting.sectionId) &&
        targetSectionRoomSetting.position < referenceSectionRoomSetting.position
      ) {
        throw new ValidationError("The position of the reference should not exceed the current section room setting position");
      }
    }

    return { validatedReference: data, sectionRoomSetting: targetSectionRoomSetting };
  }

  private async addReferencesValidationArray(
    targetSectionRoomSettingId: string,
    data: UpdateFullReferenceList
  ): Promise<{
    validatedReferences: Reference[];
    sectionRoomSetting: SectionRoomSetting;
  }> {
    // Get the target section once
    const { sectionRoomSettingIds } = data;
    const targetSectionRoomSetting = await this.getById(targetSectionRoomSettingId);
    if (!targetSectionRoomSetting) {
      throw new NotFoundError("Section Room Setting not found");
    }
    if (!sectionRoomSettingIds) {
      throw new BadRequestError("'sectionRoomSettingIds' field is required");
    }

    if (sectionRoomSettingIds.length == 0) {
      return { validatedReferences: [], sectionRoomSetting: targetSectionRoomSetting };
    }

    const userId = new ObjectId(this.context.currentProfile?.id);

    if (!targetSectionRoomSetting.createdBy?.equals(userId)) {
      throw new ForbiddenError("Unable to access to this content section setting");
    }

    const validatedReferences: Reference[] = [];

    for (const id of sectionRoomSettingIds) {
      if (new ObjectId(targetSectionRoomSettingId).equals(new ObjectId(id))) {
        throw new BadRequestError("Reference cannot be current section room");
      }

      // Ensure referenced SectionRoomSetting exists
      const referenceSectionRoomSetting = await this.getById(id);
      if (!referenceSectionRoomSetting) {
        throw new NotFoundError(`Target SectionRoomSetting with ID ${id} not found`);
      }
      if (!referenceSectionRoomSetting.createdBy?.equals(userId)) {
        throw new ForbiddenError("Unable to reference to this content section setting");
      }

      // Position check
      if (
        referenceSectionRoomSetting.sectionId.equals(targetSectionRoomSetting.sectionId) &&
        targetSectionRoomSetting.position < referenceSectionRoomSetting.position
      ) {
        throw new ValidationError(`The position of reference ${id} should not exceed the current section room setting position`);
      }

      validatedReferences.push({ sectionRoomSettingId: new ObjectId(id) });
    }

    return { validatedReferences, sectionRoomSetting: targetSectionRoomSetting };
  }
}

export default SectionRoomSettingService;
