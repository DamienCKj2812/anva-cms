import { ObjectId } from "mongodb";
import { CreateContentTranslationData } from "../../content-translation/database/models";

export interface ContentCollctionSchema {
  type: string,
  properties: Record<string, any>
  required: string[],
  additionalProperties: boolean
}

export interface ContentCollection {
  _id?: ObjectId;
  tenantId: ObjectId;
  name: string;
  displayName: string;
  schema: ContentCollctionSchema | null;
  createdAt: Date;
  updatedAt?: Date | null;
  createdBy: ObjectId;
}

export interface UpdateContentCollectionData {
  name?: string;
  displayName?: string;
}

export interface DeleteContentCollectionResponse {
  status: "success" | "failed";
  data: any;
}

export interface CreateContentCollectionData {
  tenantId: string;
  name: string;
  displayName: string;
}
