import { Router, Request, Response, NextFunction } from "express";
import { errorResponse, successResponse } from "../../utils/helper.response";
import { NotFoundError } from "../../utils/helper.errors";
import { authenticate } from "../../middleware/auth";
import { cleanupUploadedFiles } from "../../utils/helper";
import { withDynamicFieldSettings } from "../../utils/helper.fieldSetting";
import { AppContext } from "../../utils/helper.context";

const contentCollectionController = (context: AppContext) => {
  const router = Router();
  const contentCollectionService = context.diContainer!.get("ContentCollectionService");

  router.use(authenticate(context));

  router.post("/create", async (req: Request, res: Response, next: NextFunction) => {
    try {
      console.log("Creating content collection with data:", req.body);
      const contentCollection = await contentCollectionService.create(req.body);
      res.status(201).json(successResponse(contentCollection));
    } catch (err) {
      await cleanupUploadedFiles(req);
      next(err);
    }
  });

  router.post("/get", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const contentCollections = await contentCollectionService.getAll();
      res.status(200).json(successResponse(contentCollections));
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/get", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const contentCollection = await contentCollectionService.getById(req.params.id);
      if (!contentCollection) {
        throw new NotFoundError("content collection not found");
      }

      res.status(200).json(successResponse(contentCollection));
    } catch (err) {
      next(err);
    }
  });

  router.post(
    "/:id/update",
    ...withDynamicFieldSettings(contentCollectionService.collectionName, context),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const updatedContentCollection = await contentCollectionService.update(req.params.id, req.body);
        res.status(200).json(successResponse(updatedContentCollection));
      } catch (err) {
        await cleanupUploadedFiles(req);
        next(err);
      }
    },
  );

  router.post("/:id/delete", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const contentCollection = await contentCollectionService.getById(id);
      if (!contentCollection) {
        throw new NotFoundError("contentCollection not found");
      }
      const { status, data } = await contentCollectionService.delete(contentCollection);
      if (status == "failed") {
        return res
          .status(400)
          .json(errorResponse("Some content are still under this content collection", { name: "ValidationError", status: 400, errorData: data }));
      }
      res.status(200).json(successResponse(data));
    } catch (err) {
      next(err);
    }
  });

  return router;
};

export default contentCollectionController;
