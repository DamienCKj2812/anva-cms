import { ObjectId } from "mongodb";
import { Content, ContentStatusEnum } from "../../content/database/models";

export interface ContentTranslation {
  _id: ObjectId;
  tenantLocaleId: ObjectId;
  contentId: ObjectId;
  locale: string;
  data: any;
  status: ContentStatusEnum;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date | null;
  createdBy: ObjectId;
}

export interface FullContentTranslation extends ContentTranslation {
  content?: Content;
}

export interface CreateContentTranslationData {
  tenantId: string;
  data: any;
  status: string;
}

export interface UpdateContentTranslationData {
  data?: any;
  status?: string;
}
