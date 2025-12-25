import { ObjectId } from "mongodb";

export interface MediaAsset {
  _id: ObjectId;
  mediaId: string;
  tenantId: ObjectId;
  folderId: ObjectId | null;
  originalFileName: string | null;
  filePath: string;
  name: string;
  size: number;
  mimeType: string;

  // Image-specific fields
  width: number | null;
  height: number | null;
  focusX?: number;
  focusY?: number;

  // Video/audio-specific fields
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

export interface UpdateMediaAssetFocusPointData {
  focusX?: number;
  focusY?: number;
}
