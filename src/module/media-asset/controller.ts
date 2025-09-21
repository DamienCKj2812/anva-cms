import { Router, Request, Response, NextFunction } from "express";
import { successResponse } from "../../utils/helper.response";
import { Permissions, requirePermission } from "../../utils/helper.permission";
import { authenticate } from "../../middleware/auth";
import { cleanupUploadedFiles } from "../../utils/helper";
import { AppContext } from "../../utils/helper.context";
import { BadRequestError } from "../../utils/helper.errors";

const mediaAssetController = (context: AppContext) => {
  const router = Router();
  const mediaAssetService = context.diContainer!.get("MediaAssetService");
  const fileUploaderGCSService = context.diContainer!.get("FileUploaderGCSService");

  router.use(authenticate(context));

  router.post(
    "/upload-images",
    requirePermission(context, Permissions.CONTENT_COLLECTION_CREATE),
    fileUploaderGCSService.getArrayMiddleware(),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const files = req.files as Express.Multer.File[];
        if (!files || files.length === 0) {
          throw new BadRequestError("No files uploaded");
        }

        // Use transaction = true only if you want "all-or-nothing"
        const contents = await mediaAssetService.createImages(req.body, files, false);

        res.status(201).json(successResponse(contents));
      } catch (err) {
        await cleanupUploadedFiles(req);
        next(err);
      }
    }
  );

  router.post(
    "/upload-videos",
    requirePermission(context, Permissions.CONTENT_COLLECTION_CREATE),
    fileUploaderGCSService.getArrayMiddleware(),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const files = req.files as Express.Multer.File[];
        if (!files || files.length === 0) {
          throw new BadRequestError("No files uploaded");
        }

        // Use transaction = true only if you want "all-or-nothing"
        const contents = await mediaAssetService.createVideos(req.body, files, false);

        res.status(201).json(successResponse(contents));
      } catch (err) {
        await cleanupUploadedFiles(req);
        next(err);
      }
    }
  );

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
