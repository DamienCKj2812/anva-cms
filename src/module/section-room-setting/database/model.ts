import { ObjectId } from "mongodb";

export interface Reference {
  sectionRoomSettingId: ObjectId;
}

export interface SectionRoomSetting {
  _id?: ObjectId;
  flowSettingId: ObjectId;
  sectionId: ObjectId;
  chatbotSettingId: ObjectId;
  systemPrompt: string;
  references: Reference[];
  name: string;
  description: string;
  position: number;
  isDeleted?: boolean;
  createdAt?: Date;
  updatedAt?: Date | null;
  createdBy?: ObjectId;
  updatedBy?: ObjectId | null;
}

export interface SectionRoomSettingWithReferences extends SectionRoomSetting {
  hasMoreReferencesDetails: boolean;
  referencesDetails: {
    _id: string;
    name: string;
  }[];
}

export interface UpdateSectionRoomSetting {
  sectionId?: string;
  chatbotSettingId?: string;
  systemPrompt?: string;
  name?: string;
  description?: string;
}

export interface UpdatePositionData {
  sectionId: string;
  idsOrder: string[];
}

export interface AddReferenceData {
  sectionRoomSettingId?: string;
}

export interface UpdateFullReferenceList {
  sectionRoomSettingIds?: string[];
}

export type CreateSectionContentSettingData = Omit<
  SectionRoomSetting,
  "_id" | "flowSettingId" | "references" | "position" | "isDeleted" | "createdAt" | "updatedAt" | "createdBy" | "updatedBy"
>;
