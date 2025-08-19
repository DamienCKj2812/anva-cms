import { ObjectId } from "mongodb";

export enum ReferenceRoleEnum {
  user = "user",
  assistant = "assistant",
}

export interface SectionContent {
  _id?: ObjectId;
  sectionRoomId: ObjectId;
  role: ReferenceRoleEnum;
  input: string;
  output: string;
  previousResponseId?: string | null;
  position: number;
  markAsResult: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  generatedAt?: Date | null;
}

export interface GetAllBySectionRoomIdData {
  sectionRoomId: string;
  page?: number;
  limit?: number;
}

export interface UpdateSectionContentData {
  markAsResult?: boolean;
}

export interface UpdateSectionContentInputData {
  input?: string;
}

export type CreateSectionContentData = Omit<SectionContent, "_id" | "position" | "markAsResult">;
