import { ObjectId } from "mongodb";
import { ChatbotSettings } from "../../chatbot-settings/database/models";
import { SectionRoomSetting } from "../../section-room-setting/database/model";

export enum SectionRoomStatusEnum {
  pending = "pending",
  archived = "archived",
  completed = "completed",
  failed = "failed",
}

export interface SectionRoom {
  _id?: ObjectId;
  flowSettingId: ObjectId; // Not changeable
  sectionId: ObjectId; // Not changeable
  sectionRoomSettingId: ObjectId; // Not changeable
  chatbotSettingId: ObjectId; // Not changeable
  draftInput: string;
  status: SectionRoomStatusEnum;
  sectionContentCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  errMsg: string;
  createdAt?: Date;
  updatedAt?: Date | null;
  createdBy?: ObjectId;
  updatedBy?: ObjectId | null;
}

export interface UpdateSectionRoomData {
  status?: SectionRoomStatusEnum;
  errMsg?: string;
}

export interface UpdateDraftInputValidation {
  draftInput: string;
}

export interface InitSectionRoomData {
  sectionRoom: SectionRoom;
  sectionRoomSetting: Partial<SectionRoomSetting>;
  chatbotSetting: Partial<ChatbotSettings>;
}

export type CreateSectionRoomData = Omit<
  SectionRoom,
  | "_id"
  | "flowSettingId"
  | "sectionId"
  | "chatbotSettingId"
  | "status"
  | "sectionContentCount"
  | "draftInput"
  | "totalInputTokens"
  | "totalOutputTokens"
  | "errMsg"
  | "createdAt"
  | "updatedAt"
  | "updatedBy"
>;
