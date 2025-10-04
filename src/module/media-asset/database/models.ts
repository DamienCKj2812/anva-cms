import { ObjectId } from "mongodb";

export enum MediaTypeEnum {
  FILE = "file",
  FOLDER = "folder",
}

export interface MediaAsset {
  _id?: ObjectId;
  tenantId: ObjectId;
  parentId: ObjectId | null; // under which folder
  mediaType: MediaTypeEnum; // "file" or "folder"
  originalFileName: string; // server only
  name: string; // for client

  // File-specific fields (only for type = 'file')
  storageKey: string | null;
  size: number;
  mimeType: string;
  url: string;

  // Image-specific fields (only for images)
  width: number | null;
  height: number | null;

  // Video/audio-specific fields (optional)
  duration: number | null;
  thumbnailUrl: string | null;

  // Optional metadata
  metadata: any;

  // Auditing
  createdBy: ObjectId;
  createdAt: Date;
  updatedAt: Date | null;
}

export interface CreateFileData {
  tenantId: string;
  parentId: string | null;
}

export interface CreateFolderData {
  tenantId: string;
  parentId?: string;
}

export interface UpdateMediaAsset {
  mediaType: string;
  parentId: string;
  name: string;
  mimeType: string;
  size: string;
  storageKey: string;
  url: string;
}
