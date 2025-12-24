import { ObjectId } from "mongodb";

export interface MediaAsset {
  _id: ObjectId;
  mediaId: string; // hash / UUID for public reference
  tenantId: ObjectId;
  folderId: ObjectId | null; // under which folder
  originalFileName: string | null; // file only (for server)
  filePath: string;
  name: string; // for client
  size: number;
  mimeType: string;

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

export interface UpdateMediaAssetData {
  folderId?: string;
  name?: string;
}
