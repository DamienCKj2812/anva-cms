import { ObjectId } from "mongodb";
import { Content, ContentStatusEnum } from "../../content/database/models";
import { ContentCollection } from "../../content-collection/database/models";


export interface ContentTranslation {
  _id: ObjectId;
  contentCollectionId: ObjectId;
  contentId: ObjectId;
  locale: string
  data: any
  status: ContentStatusEnum
  createdAt: Date;
  updatedAt: Date | null;
  createdBy: ObjectId
}


export interface FullContentTranslation extends ContentTranslation {
  contentCollection?: ContentCollection
  content?: Content
}

export interface CreateContentTranslationData {
  locale: string
  data: string;
  status: string;
}

export interface UpdateContentTranslationData {
  data?: string;
  status?: string;
}
