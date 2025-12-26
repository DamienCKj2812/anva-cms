import { ObjectId } from "mongodb";
import { CreateContentTranslationData } from "../../content-translation/database/models";
import { TenantLocale } from "../../tenant-locale/database/models";

export enum ContentStatusEnum {
  DRAFT = "draft",
  PUBLISHED = "published",
  ARCHIVED = "ajchived",
}

export interface Content {
  _id: ObjectId;
  tenantId: ObjectId;
  contentCollectionId: ObjectId;
  data: any; // Shared fields (non-translatable)
  status: ContentStatusEnum;
  position: number;
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

export interface FullContent extends Content {
  requestedLocale: string;
  resolvedLocale: string;
  localeNotFound: boolean;
  tenantLocale: TenantLocale;
  fullData: any;
}

export interface ReorderContentsDTO {
  contentIds: string[]; // ordered array, top → bottom
}
