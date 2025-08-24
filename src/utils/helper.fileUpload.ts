import multer, { Multer, StorageEngine } from "multer";
import path from "path";
import fs from "fs";

interface FileUploadConfig {
  allowedMimeTypes: string[];
  maxFileSize: number;
  uploadDirectory: string;
  maxFiles?: number;
}

class FileUploader {
  public upload: Multer;
  private config: FileUploadConfig;

  constructor(config: FileUploadConfig) {
    this.config = {
      ...config,
      maxFiles: config.maxFiles || 50,
    };
    this.ensureUploadDirExists();
    this.upload = this.configureMulter();
  }

  private ensureUploadDirExists(): void {
    if (!fs.existsSync(this.config.uploadDirectory)) {
      fs.mkdirSync(this.config.uploadDirectory, { recursive: true });
    }
  }

  private generateUniqueFilename(
    directory: string,
    originalName: string
  ): string {
    const ext = path.extname(originalName);
    const baseName = path.basename(originalName, ext);
    let counter = 0;
    let newName = originalName;

    while (fs.existsSync(path.join(directory, newName))) {
      counter++;
      newName = `${baseName}(${counter})${ext}`;
    }

    return newName;
  }

  private configureMulter(): Multer {
    const storage: StorageEngine = multer.diskStorage({
      destination: (req, file, cb) => {
        cb(null, this.config.uploadDirectory);
      },
      filename: (req, file, cb) => {
        const uniqueName = this.generateUniqueFilename(
          this.config.uploadDirectory,
          file.originalname
        );
        cb(null, uniqueName);
      },
    });

    return multer({
      storage,
      limits: { fileSize: this.config.maxFileSize },
      fileFilter: (req, file, cb) => {
        if (this.config.allowedMimeTypes.includes("*")) {
          cb(null, true);
        } else if (this.config.allowedMimeTypes.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(
            new Error(
              `Invalid file type. Allowed types: ${this.config.allowedMimeTypes.join(
                ", "
              )}`
            )
          );
        }
      },
    });
  }

  public getSingleMiddleware(fieldName: string = "file") {
    return this.upload.single(fieldName);
  }

  public getArrayMiddleware(fieldName: string = "files", maxCount?: number) {
    return this.upload.array(fieldName, maxCount || this.config.maxFiles);
  }

  public getNamedFieldsMiddleware(
    fields: { name: string; maxCount?: number }[]
  ) {
    return this.upload.fields(fields);
  }

  // Used for fieldsetting 'FILE' uploads
  public getSingleDynamicFieldMiddleware() {
    return (req, res, next) => {
      const anyUpload = this.upload.any();

      anyUpload(req, res, async (err) => {
        if (err) return next(err);

        if (!req.files || req.files.length === 0) {
          return next(); // No file uploaded
        }

        if (req.files.length > 1) {
          // Delete all uploaded files immediately
          const filePaths = req.files.map((file) => file.path);
          this.deleteFiles(filePaths);
          return next(new Error("Only one file is allowed."));
        }

        // Assign the single uploaded file to req.file for consistency
        req.file = req.files[0];
        next();
      });
    };
  }

  // Filter valid fields and upload files if valid
  public getValidatedDynamicFieldMiddleware(allowedFieldNames: string[]) {
    const allowedSet = new Set(allowedFieldNames);

    const storage: StorageEngine = multer.diskStorage({
      destination: (req, file, cb) => {
        cb(null, this.config.uploadDirectory);
      },
      filename: (req, file, cb) => {
        const uniqueName = this.generateUniqueFilename(
          this.config.uploadDirectory,
          file.originalname
        );
        cb(null, uniqueName);
      },
    });

    const multerInstance = multer({
      storage,
      limits: { fileSize: this.config.maxFileSize },
      fileFilter: (req, file, cb) => {
        const isEmpty = !file.originalname || file.originalname === "undefined";
        const fieldName = file.fieldname.split(".")[1];
        if (isEmpty || !allowedSet.has(fieldName)) {
          return cb(null, false);
        }
        cb(null, true);
      },
    });

    return multerInstance.any();
  }

  public async deleteFile(filePath: string): Promise<void> {
    if (!filePath || typeof filePath !== "string") {
      throw new Error(
        `Invalid file path: ${filePath}. Path must be a non-empty string`
      );
    }

    try {
      const normalizedPath = path.normalize(filePath);

      try {
        await fs.promises.access(normalizedPath, fs.constants.F_OK);
      } catch (err) {
        const accessErr = err as NodeJS.ErrnoException;
        if (accessErr.code === "ENOENT") {
          // File doesn't exist - treat as successful deletion
          return;
        }
        throw accessErr;
      }

      await fs.promises.unlink(normalizedPath);
    } catch (err) {
      const fsError = err as NodeJS.ErrnoException;
      if (fsError.code === "ENOENT") {
        return;
      }

      const errorMessages: Record<string, string> = {
        EPERM: "Delete operation not permitted",
        EBUSY: "File is currently in use",
        EISDIR: "Cannot delete a directory with this method",
        EACCES: "Insufficient permissions to delete file",
      };

      const message = fsError.code
        ? errorMessages[fsError.code] || "Failed to delete file"
        : "Failed to delete file";
      throw new Error(`${message}: ${filePath}`);
    }
  }

  public async deleteFiles(filePaths: string[]): Promise<void> {
    return Promise.all(filePaths.map((path) => this.deleteFile(path)))
      .then(() => {})
      .catch((err) => {
        throw err;
      });
  }

  // Example: normalize file path from assets\\media\\image.jpg to assets/media/image.jpg
  // Needs to call everytime when saving file path into database
  public normalizePath(path: string): string {
    return path.replace(/\\/g, "/");
  }
}

export default FileUploader;
