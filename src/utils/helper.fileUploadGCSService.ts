import multer, { Multer } from "multer";
import { Storage } from "@google-cloud/storage";
import path from "path";
import { AppContext } from "./helper.context";
import configs from "../configs";
import { BaseService } from "../module/core/base-service";
import { BadRequestError } from "./helper.errors";
import sharp from "sharp";

export interface FileUploadGCSConfig {
  allowedMimeTypes: string[];
  maxFileSize: number;
  maxFiles?: number;
}

class FileUploaderGCSService extends BaseService {
  private config: FileUploadGCSConfig;
  private storage: Storage;
  private bucket;
  public upload: Multer;

  constructor(context: AppContext) {
    super(context);
  }

  getInstance({
    allowedMimeTypes,
    maxFileSize,
    maxFiles,
  }: {
    allowedMimeTypes?: string[];
    maxFileSize?: number;
    maxFiles?: number;
  }): FileUploaderGCSService {
    this.config = {
      allowedMimeTypes: allowedMimeTypes || configs.GCLOUD_CONFIGS.ALLOWED_MIME_TYPES,
      maxFileSize: maxFileSize || configs.GCLOUD_CONFIGS.MAX_FILE_SIZE,
      maxFiles: maxFiles || configs.GCLOUD_CONFIGS.MAX_FILES,
    };
    this.storage = new Storage({
      keyFilename: path.join(__dirname, "../../gcloud-service-account.json"),
    });
    this.upload = this.configureMulter();
    return this;
  }

  // Configure multer (memory storage)
  private configureMulter(): Multer {
    return multer({
      storage: multer.memoryStorage(),
      fileFilter: (req, file, cb) => {
        // Allowed types
        const allowedMimeTypes = this.config.allowedMimeTypes;

        if (!allowedMimeTypes.includes(file.mimetype)) {
          return cb(new Error(`Invalid file type. Allowed: ${allowedMimeTypes.join(", ")}`));
        }

        const maxSize = file.mimetype.startsWith("image/")
          ? 10 * 1024 * 1024 // 10 MB
          : file.mimetype.startsWith("video/")
            ? 500 * 1024 * 1024 // 500 MB
            : 0;

        if (file.size > maxSize) {
          return cb(new Error(`File too large. Max allowed size for this type is ${maxSize / 1024 / 1024}MB`));
        }

        cb(null, true); // accept file
      },
    });
  }

  public async uploadImageToGCS(
    file: Express.Multer.File,
    clientWidth?: number,
  ): Promise<{ mimetype: string; storageKey: string; url: string; width: number; height: number }> {
    if (!file.mimetype.startsWith("image/")) {
      throw new BadRequestError(`${file.originalname} is not an image`);
    }

    let image = sharp(file.buffer);

    if (clientWidth) {
      image = image.resize({ width: clientWidth });
    }

    const webpBuffer = await image.webp({ quality: 80 }).toBuffer();

    // Get metadata
    const metadata = await sharp(webpBuffer).metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;

    // Set bucket and storage key
    const bucketName = this.context.orgBucketName || configs.GCLOUD_CONFIGS.GCLOUD_DEFAULT_BUCKET;
    const bucket = this.storage.bucket(bucketName);

    // Change file extension to .webp
    const storageKey = this.getStorageKey(file).replace(/\.\w+$/, ".webp");
    const blob = bucket.file(storageKey);

    // Upload
    await new Promise<void>((resolve, reject) => {
      const stream = blob.createWriteStream({
        metadata: { contentType: "image/webp" },
        resumable: false,
      });

      stream.on("error", reject);
      stream.on("finish", () => resolve());
      stream.end(webpBuffer);
    });

    return {
      mimetype: "image/webp",
      storageKey,
      url: `https://storage.googleapis.com/${bucket.name}/${storageKey}`,
      width,
      height,
    };
  }

  public async uploadVideoToGCS(file: Express.Multer.File): Promise<{ storageKey: string; url: string }> {
    if (!file.mimetype.startsWith("video/")) {
      throw new BadRequestError(`Invalid file type: ${file.originalname} is not an video`);
    }
    const bucketName = this.context.orgBucketName || configs.GCLOUD_CONFIGS.GCLOUD_DEFAULT_BUCKET;
    const bucket = this.storage.bucket(bucketName);
    const storageKey = this.getStorageKey(file);
    const blob = bucket.file(storageKey);

    return new Promise((resolve, reject) => {
      const stream = blob.createWriteStream({
        metadata: { contentType: file.mimetype },
        resumable: true, // large file
      });

      stream.on("error", reject);
      stream.on("finish", () => resolve({ storageKey, url: `https://storage.googleapis.com/${bucket.name}/${storageKey}` }));
      stream.end(file.buffer);
    });
  }

  // Multer middlewares
  public getSingleMiddleware(fieldName: string = "file") {
    return this.upload.single(fieldName);
  }

  public getArrayMiddleware(fieldName: string = "files", maxCount?: number) {
    return this.upload.array(fieldName, maxCount || this.config.maxFiles);
  }

  public getNamedFieldsMiddleware(fields: { name: string; maxCount?: number }[]) {
    return this.upload.fields(fields);
  }

  public getFolderPrefix(context: AppContext) {
    return `org-${context.currentUser?.id}/uploads`;
  }

  public getStorageKey(file: Express.Multer.File): string {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    return `${this.getFolderPrefix(this.context)}/${uniqueName}`;
  }

  async compressImage(file: Express.Multer.File, clientWidth?: number): Promise<Buffer> {
    const metadata = await sharp(file.buffer).metadata();

    let width = metadata.width ?? undefined;
    if (clientWidth && clientWidth > 0) {
      width = Math.min(clientWidth, 3840);
    }

    const pipeline = sharp(file.buffer).resize({ width });

    switch (file.mimetype) {
      case "image/jpeg":
      case "image/jpg":
        return pipeline.jpeg({ quality: 80 }).toBuffer();
      case "image/png":
        return pipeline.png({ compressionLevel: 9 }).toBuffer();
      case "image/webp":
        return pipeline.webp({ quality: 80 }).toBuffer();
      default:
        throw new Error(`Unsupported image type: ${file.mimetype}`);
    }
  }
}

export default FileUploaderGCSService;
