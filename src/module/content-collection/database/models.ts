import { ObjectId } from "mongodb";

export enum ContentCollectionTypeEnum {
  COLLECTION = "collection",
  SINGLE = "single",
}

export interface ContentCollection {
  _id: ObjectId;
  tenantId: ObjectId;
  slug: string;
  displayName: string;
  type: ContentCollectionTypeEnum;
  schema: any | null;
  createdAt: Date;
  updatedAt?: Date | null;
  createdBy: ObjectId;
}

export interface UpdateContentCollectionData {
  slug?: string;
  displayName?: string;
}

export interface CreateContentCollectionData {
  type: ContentCollectionTypeEnum;
  slug: string;
  name: string;
  displayName: string;
}
