import { ObjectId } from "mongodb";
import { Section } from "../../section/database/model";

export interface FlowSetting {
  _id?: ObjectId;
  name: string;
  createdAt?: Date;
  updatedAt?: Date | null;
  createdBy?: ObjectId;
  updatedBy?: ObjectId | null;
}

export interface FlowSettingWithSectionName extends FlowSetting {
  hasMoreSections: boolean;
  sections: Partial<Section>[];
}

export interface UpdateFlowSettingData {
  name?: string;
}

export interface AssignReceiverData {
  receivedBy?: string;
}

export type CreateFlowSettingData = Omit<FlowSetting, "_id" | "createdAt" | "updatedAt" | "createdBy" | "updatedBy">;
