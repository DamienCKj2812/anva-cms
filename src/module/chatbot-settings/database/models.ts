import { ObjectId } from "mongodb";

export interface ChatbotSettings {
  _id?: ObjectId;
  name: string;
  token: string;
  type: string;
  model: string;
  createdAt?: Date;
  updatedAt?: Date;
  createdBy?: ObjectId;
  updatedBy?: ObjectId | null;
}

export interface ChatbotSettingsUpdateData {
  name?: string;
  token?: string;
  type?: string;
  model?: string;
}

export type CreateChatbotSettingsData = Omit<ChatbotSettings, "_id" | "isDeleted" | "createdAt" | "updatedAt" | "createdBy" | "updatedBy">;
