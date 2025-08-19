import { ObjectId } from "mongodb";
import { SectionRoom } from "../../section-room/database/model";

export interface Section {
  _id?: ObjectId;
  flowSettingId: ObjectId;
  name: string;
  description: string;
  sectionRoomSettingCount: number;
  createdAt?: Date;
  updatedAt?: Date | null;
  createdBy?: ObjectId;
  updatedBy?: ObjectId | null;
}

export interface SectionsWithSectionRoomSettingName extends Section {
  hasMoreSectionRoomSettings: boolean;
  sectionRoomSettings: Partial<SectionRoom>[];
}

export interface UpdateSectionData {
  flowSettingId: string;
  name?: string;
  description?: string;
}

export type CreateSectionData = Omit<Section, "_id" | "createdAt" | "sectionRoomSettingCount" | "updatedAt" | "createdBy" | "updatedBy">;
