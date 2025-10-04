import { ObjectId } from "mongodb";

export interface ContentCollection {
  _id?: ObjectId;
  tenantId: ObjectId;
  name: string;
  displayName: string;
  schema: any | null;
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

export type CreateContentCollectionData = Omit<ContentCollection, "_id" | "createdAt" | "updatedAt" | "createdBy">;
