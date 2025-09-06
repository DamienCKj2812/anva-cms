import { Router, Request, Response, NextFunction } from "express";
import { errorResponse, successResponse } from "../../utils/helper.response";
import { Permissions, requirePermission } from "../../utils/helper.permission";
import { NotFoundError } from "../../utils/helper.errors";
import { authenticate } from "../../middleware/auth";
import { cleanupUploadedFiles } from "../../utils/helper";
import { withDynamicFieldSettings } from "../../utils/helper.fieldSetting";
import { AppContext } from "../../utils/helper.context";

const contentCollectionController = (context: AppContext) => {
  const router = Router();
  const contentCollectionService = context.diContainer!.get("ContentCollectionService");

  router.use(authenticate(context));

  router.post(
    "/create",
    requirePermission(context, Permissions.CONTENT_COLLECTION_CREATE),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        console.log("Creating content collection with data:", req.body);
        const contentCollection = await contentCollectionService.create(req.body);
        res.status(201).json(successResponse(contentCollection));
      } catch (err) {
        await cleanupUploadedFiles(req);
        next(err);
      }
    }
  );

  router.post(
    "/get",
    requirePermission(context, Permissions.CONTENT_COLLECTION_READ_ALL),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { data, metadata } = await contentCollectionService.getAll({
          ...req.body,
        });
        res.status(200).json(successResponse(data, metadata));
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    "/:id/get",
    requirePermission(context, Permissions.CONTENT_COLLECTION_READ),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const contentCollection = await contentCollectionService.getById(req.params.id);
        if (!contentCollection) {
          throw new NotFoundError("content collection not found");
        }

        res.status(200).json(successResponse(contentCollection));
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    "/:id/update",
    requirePermission(context, Permissions.CONTENT_COLLECTION_UPDATE),
    ...withDynamicFieldSettings(contentCollectionService.collectionName, context),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const updatedContentCollection = await contentCollectionService.update(req.params.id, req.body);
        res.status(200).json(successResponse(updatedContentCollection));
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
        const { status, data } = await contentCollectionService.delete(req.params.id);
        if (status == "failed") {
          return res
            .status(400)
            .json(
              errorResponse("Some attributes are still under this content collection", { name: "ValidationError", status: 400, errorData: data })
            );
        }
        res.status(200).json(successResponse(data));
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
};

export default contentCollectionController;
