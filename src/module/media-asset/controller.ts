import { Router, Request, Response, NextFunction } from "express";
import { successResponse } from "../../utils/helper.response";
import { authenticate } from "../../middleware/auth";
import { AppContext } from "../../utils/helper.context";
import { BadRequestError, NotFoundError } from "../../utils/helper.errors";
import { getCurrentUserId } from "../../utils/helper.auth";
import FileUploaderGCSService from "../../utils/helper.fileUploadGCSService";
import { ObjectId } from "mongodb";
import FileUploader from "../../utils/helper.fileUpload";
import { Folder } from "../folder/database/models";
import { cleanupUploadedFiles, compressImage } from "../../utils/helper";
import path from "path";
import fs from "fs/promises";

const mediaAssetController = (context: AppContext) => {
  const router = Router();
  const mediaAssetService = context.diContainer!.get("MediaAssetService");
  const tenantService = context.diContainer!.get("TenantService");
  const folderService = context.diContainer!.get("FolderService");

  router.use(authenticate(context));

  router.post("/get", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getCurrentUserId(context);
      const { tenantId, folderId } = req.query as { tenantId?: string; folderId?: string };
      const filter: any = {
        createdBy: new ObjectId(userId),
      };
      if (tenantId) {
        filter.tenantId = new ObjectId(tenantId);
      }
      filter.folderId = folderId ? new ObjectId(folderId) : null;
      const contents = await mediaAssetService.findMany(filter);
      res.status(200).json(successResponse(contents));
    } catch (err) {
      next(err);
    }
  });

  router.post("/get-batch", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ids } = req.body;
      const { filter } = req.query as { filter?: string };
      if (!Array.isArray(ids)) {
        throw new NotFoundError("'ids' must be provided and must be an array");
      }
      let mongoFilter: any = {};
      switch (filter) {
        case "byId":
          mongoFilter = {
            _id: { $in: ids.map((i) => new ObjectId(i)) },
          };
          break;
        case "byUrl":
          mongoFilter = {
            url: { $in: ids },
          };
          break;
        default:
          throw new NotFoundError("Please provide ?filter=byId or ?filter=byUrl");
      }
      const mediaAssets = await mediaAssetService.findMany(mongoFilter);
      console.log({ mediaAssets });
      if (!mediaAssets || mediaAssets.length === 0) {
        throw new NotFoundError("Media assets not found");
      }
      res.status(200).json(successResponse(mediaAssets));
    } catch (err) {
      next(err);
    }
  });

  router.post("/:tenantId/upload-images", async (req, res, next) => {
    try {
      const { tenantId } = req.params;
      const { folderId } = req.body;

      const userId = getCurrentUserId(context);
      const tenant = await tenantService.findOne({ _id: new ObjectId(tenantId) });
      if (!tenant) throw new NotFoundError("tenant not found");

      let folder: Folder | null = null;
      if (folderId !== undefined) {
        folder = await folderService.findOne({ _id: new ObjectId(folderId) });
      }

      const uploader = new FileUploader({
        allowedMimeTypes: ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/tiff"],
        maxFileSize: 10 * 1024 * 1024,
        uploadDirectory: `uploads/media/${userId}/${tenant._id}`,
      });

      uploader.getArrayMiddleware("files")(req, res, async (err) => {
        if (err) return next(err);

        try {
          const files = req.files as Express.Multer.File[];
          if (!files || files.length === 0) {
            throw new BadRequestError("No files uploaded");
          }

          // Process files in parallel
          await Promise.all(
            files.map(async (file) => {
              const compressedBuffer = await compressImage(file);

              const hashedName = path.basename(file.filename, path.extname(file.filename)) + ".webp";
              const outputPath = path.join(path.dirname(file.path), hashedName);

              await fs.writeFile(outputPath, compressedBuffer);

              try {
                await fs.unlink(file.path);
              } catch (unlinkErr) {
                console.warn(`Failed to delete original file ${file.path}:`, unlinkErr);
              }

              file.path = outputPath;
              file.filename = hashedName;
              file.mimetype = "image/webp";
              file.size = compressedBuffer.length;
            }),
          );

          const contents = await mediaAssetService.createImages(files, tenant, folder ?? undefined);
          res.status(201).json(successResponse(contents));
        } catch (innerErr) {
          cleanupUploadedFiles(req);
          next(innerErr);
        }
      });
    } catch (outerErr) {
      next(outerErr);
    }
  });

  router.post("/:tenantId/upload-applications", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId } = req.params;
      const { folderId } = req.body;

      const userId = getCurrentUserId(context);
      const tenant = await tenantService.findOne({ _id: new ObjectId(tenantId) });
      if (!tenant) throw new NotFoundError("tenant not found");

      let folder: Folder | null = null;
      if (folderId !== undefined) {
        folder = await folderService.findOne({ _id: new ObjectId(folderId) });
      }

      const uploader = new FileUploader({
        allowedMimeTypes: ["application/pdf"],
        maxFileSize: 500 * 1024 * 1024,
        uploadDirectory: `uploads/media/${userId}/${tenant._id}`,
      });

      uploader.getArrayMiddleware("files")(req, res, async (err) => {
        if (err) return next(err);

        try {
          const files = req.files as Express.Multer.File[];
          if (!files || files.length === 0) throw new BadRequestError("No files uploaded");

          const contents = await mediaAssetService.createApplications(files, tenant, folder ?? undefined);
          res.status(201).json(successResponse(contents));
        } catch (innerErr) {
          cleanupUploadedFiles(req);
          next(innerErr);
        }
      });
    } catch (outerErr) {
      next(outerErr);
    }
  });

  router.post("/:tenantId/upload-videos", async (req, res, next) => {
    try {
      const { tenantId } = req.params;
      const { folderId } = req.body;

      const userId = getCurrentUserId(context);
      const tenant = await tenantService.findOne({ _id: new ObjectId(tenantId) });
      if (!tenant) {
        throw new NotFoundError("tenant not found");
      }

      let folder: Folder | null;
      if (folderId !== undefined) {
        folder = await folderService.findOne({ _id: new ObjectId(folderId) });
      }

      const uploader = new FileUploader({
        allowedMimeTypes: ["video/mp4", "video/webm"],
        maxFileSize: 500 * 1024 * 1024,
        uploadDirectory: `uploads/media/${userId}/${tenant._id}`,
      });

      uploader.getArrayMiddleware("files")(req, res, async (err) => {
        if (err) return next(err);

        try {
          const files = req.files as Express.Multer.File[];
          if (!files || files.length === 0) {
            throw new BadRequestError("No files uploaded");
          }

          const contents = await mediaAssetService.createVideos(files, tenant, folder ?? undefined);
          res.status(201).json(successResponse(contents));
        } catch (err) {
          cleanupUploadedFiles(req);
          next(err);
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:id/update", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const mediaAsset = await mediaAssetService.findOne({ _id: new ObjectId(id) });
      if (!mediaAsset) {
        throw new NotFoundError("media asset not found");
      }
      const updatedMediaAsset = await mediaAssetService.update(req.body, mediaAsset);
      res.status(200).json(successResponse(updatedMediaAsset));
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/delete", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const mediaAsset = await mediaAssetService.findOne({ _id: new ObjectId(id) });
      if (!mediaAsset) {
        throw new NotFoundError("media asset not found");
      }
      const deletedMediaAsset = await mediaAssetService.delete(mediaAsset);
      const uploader = new FileUploader({
        allowedMimeTypes: ["*"],
        maxFileSize: 0,
        uploadDirectory: `uploads/media/${deletedMediaAsset.createdBy}/${deletedMediaAsset.tenantId}`,
      });
      await uploader.deleteFile(mediaAsset.filePath);
      res.status(200).json(successResponse(mediaAsset));
    } catch (err) {
      next(err);
    }
  });

  return router;
};

export default mediaAssetController;
