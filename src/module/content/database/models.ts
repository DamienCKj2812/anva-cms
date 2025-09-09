import { ObjectId } from "mongodb";

export enum ContentStatusEnum {
  DRAFT = "draft",
  PUBLISHED = "published",
  ARCHIVED = "archived",
}

export interface Content {
  _id?: ObjectId;
  contentCollectionId: ObjectId;
  data: any;
  status: ContentStatusEnum;
  createdAt: Date;
  updatedAt: Date | null;
}

export interface CreateContentData {
  contentCollectionId: string;
  data: string;
  status: string;
}

export interface UpdateContentData {
  data?: string;
  status?: string;
}
