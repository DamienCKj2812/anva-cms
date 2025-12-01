import { ObjectId } from "mongodb";

export interface Folder {
  _id: ObjectId;
  tenantId: ObjectId;
  parentId: ObjectId | null;
  name: string;
  metadata: any;
  createdBy: ObjectId;
  createdAt: Date;
  updatedAt: Date | null;
}

export interface CreateFolderData {
  tenantId: string;
  parentId?: string;
  name: string;
}

