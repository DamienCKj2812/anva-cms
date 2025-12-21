import { Router, Request, Response, NextFunction } from "express";
import { successResponse } from "../../utils/helper.response";
import { authenticate } from "../../middleware/auth";
import { AppContext } from "../../utils/helper.context";
import { BadRequestError, NotFoundError } from "../../utils/helper.errors";
import { getCurrentUserId } from "../../utils/helper.auth";
import FileUploaderGCSService from "../../utils/helper.fileUploadGCSService";
import { ObjectId } from "mongodb";

const mediaAssetController = (context: AppContext) => {
  const router = Router();
  const mediaAssetService = context.diContainer!.get("MediaAssetService");

  router.use(authenticate(context));

  router.post("/get", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getCurrentUserId(context);
      const { tenantId, parentId } = req.query as { tenantId?: string; parentId?: string };
      const filter: any = {
        createdBy: new ObjectId(userId),
      };
      if (tenantId) {
        filter.tenantId = new ObjectId(tenantId);
      }
      filter.parentId = parentId ? new ObjectId(parentId) : null;
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

  router.post("/:tenantId/:googleProjectId/upload-images", async (req, res, next) => {
    try {
      const gcsService = new FileUploaderGCSService(context).getInstance({});
      gcsService.getArrayMiddleware("files")(req, res, async (err) => {
        if (err) return next(err);
        try {
          const files = req.files as Express.Multer.File[];

          if (!files || files.length === 0) {
            throw new BadRequestError("No files uploaded");
          }
          const contents = await mediaAssetService.createImages({ tenantId: req.params.tenantId, parentId: req.body.parentId }, files, gcsService);
          res.status(201).json(successResponse(contents));
        } catch (err) {
          next(err);
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:tenantId/:googleProjectId/upload-videos", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const gcsService = new FileUploaderGCSService(context).getInstance({});
      gcsService.getArrayMiddleware()(req, res, async (err) => {
        if (err) return next(err);
        try {
          const files = req.files as Express.Multer.File[];

          if (!files || files.length === 0) {
            throw new BadRequestError("No files uploaded");
          }
          const contents = await mediaAssetService.createVideos({ tenantId: req.params.tenantId, parentId: req.body.parentId }, files, gcsService);
          res.status(201).json(successResponse(contents));
        } catch (err) {
          next(err);
        }
      });
    } catch (error) {
      next(error);
    }
  });

  // router.post(
  //   "/:id/get",
  //   requirePermission(context, Permissions.CONTENT_COLLECTION_READ),
  //   async (req: Request, res: Response, next: NextFunction) => {
  //     try {
  //       const content = await contentService.getById(req.params.id);
  //       res.status(200).json(successResponse(content));
  //     } catch (err) {
  //       next(err);
  //     }
  //   }
  // );

  // router.post(
  //   "/:id/update",
  //   requirePermission(context, Permissions.CONTENT_COLLECTION_UPDATE),
  //   async (req: Request, res: Response, next: NextFunction) => {
  //     try {
  //       const updatedContent = await contentService.update(req.params.id, req.body);
  //       res.status(200).json(successResponse(updatedContent));
  //     } catch (err) {
  //       await cleanupUploadedFiles(req);
  //       next(err);
  //     }
  //   }
  // );

  // router.post(
  //   "/:id/delete",
  //   requirePermission(context, Permissions.CONTENT_COLLECTION_DELETE),
  //   async (req: Request, res: Response, next: NextFunction) => {
  //     try {
  //       const deletedContent = await contentService.delete(req.params.id);
  //       res.status(200).json(successResponse(deletedContent));
  //     } catch (err) {
  //       next(err);
  //     }
  //   }
  // );

  return router;
};

export default mediaAssetController;
