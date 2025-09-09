import { Router, Request, Response, NextFunction } from "express";
import { successResponse } from "../../utils/helper.response";
import { Permissions, requirePermission } from "../../utils/helper.permission";
import { authenticate } from "../../middleware/auth";
import { cleanupUploadedFiles } from "../../utils/helper";
import { AppContext } from "../../utils/helper.context";

const contentController = (context: AppContext) => {
  const router = Router();
  const contentService = context.diContainer!.get("ContentService");

  router.use(authenticate(context));

  router.post(
    "/create",
    requirePermission(context, Permissions.CONTENT_COLLECTION_CREATE),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        console.log("Creating content with data:", req.body);
        const content = await contentService.create(req.body);
        res.status(201).json(successResponse(content));
      } catch (err) {
        await cleanupUploadedFiles(req);
        next(err);
      }
    }
  );

  router.post(
    "/:id/get",
    requirePermission(context, Permissions.CONTENT_COLLECTION_READ),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const content = await contentService.getById(req.params.id);
        res.status(200).json(successResponse(content));
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    "/:id/update",
    requirePermission(context, Permissions.CONTENT_COLLECTION_UPDATE),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const updatedContent = await contentService.update(req.params.id, req.body);
        res.status(200).json(successResponse(updatedContent));
      } catch (err) {
        await cleanupUploadedFiles(req);
        next(err);
      }
    }
  );

  router.post(
    "/:id/delete",
    requirePermission(context, Permissions.CONTENT_COLLECTION_DELETE),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const deletedContent = await contentService.delete(req.params.id);
        res.status(200).json(successResponse(deletedContent));
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
};

export default contentController;
