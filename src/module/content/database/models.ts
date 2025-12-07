import { ObjectId } from "mongodb";
import { CreateContentTranslationData } from "../../content-translation/database/models";

export enum ContentStatusEnum {
  DRAFT = "draft",
  PUBLISHED = "published",
  ARCHIVED = "archived",
}

export interface Content {
  _id: ObjectId;
  tenantId: ObjectId;
  contentCollectionId: ObjectId;
  data: any; // Shared fields (non-translatable)
  status: ContentStatusEnum;
  createdAt: Date;
  updatedAt: Date | null;
  createdBy: ObjectId;
}

export interface ContentCount {
  _id: ObjectId;
  count: number;
}

export interface CreateContentData {
  status: string;
  data: any;
}

export interface UpdateContentData {
  status?: string;
  data?: any;
}
