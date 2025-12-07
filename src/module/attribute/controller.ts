import { Router, Request, Response, NextFunction } from "express";
import { successResponse } from "../../utils/helper.response";
import { ForbiddenError, NotFoundError } from "../../utils/helper.errors";
import { authenticate } from "../../middleware/auth";
import { cleanupUploadedFiles } from "../../utils/helper";
import { withDynamicFieldSettings } from "../../utils/helper.fieldSetting";
import { AppContext } from "../../utils/helper.context";
import { validateObjectId } from "../../utils/helper.mongo";
import { ObjectId } from "mongodb";
import { getCurrentUserId } from "../../utils/helper.auth";

const attributeController = (context: AppContext) => {
  const router = Router();
  const attributeService = context.diContainer!.get("AttributeService");
  const contentCollectionService = context.diContainer!.get("ContentCollectionService");

  router.use(authenticate(context));

  router.post("/:contentCollectionId/create-primitive", async (req: Request, res: Response, next: NextFunction) => {
    try {
      console.log("Creating attribute with data:", req.body);
      const contentCollection = await contentCollectionService.findOne({ _id: new ObjectId(req.params.contentCollectionId) });
      if (!contentCollection) {
        throw new NotFoundError("content collection not found");
      }
      const attribute = await attributeService.createPrimitiveAttribute(req.body, contentCollection);
      res.status(201).json(successResponse(attribute));
    } catch (err) {
      await cleanupUploadedFiles(req);
      next(err);
    }
  });

  router.post("/:contentCollectionId/create-component", async (req: Request, res: Response, next: NextFunction) => {
    try {
      console.log("Creating attribute with data:", req.body);
      const contentCollection = await contentCollectionService.findOne({ _id: new ObjectId(req.params.contentCollectionId) });
      if (!contentCollection) {
        throw new NotFoundError("content collection not found");
      }
      const attribute = await attributeService.createComponentAttribute(req.body, contentCollection);
      res.status(201).json(successResponse(attribute));
    } catch (err) {
      await cleanupUploadedFiles(req);
      next(err);
    }
  });

  router.post("/:collectionId/get-by-collection", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const collectionId = req.params.collectionId;
      validateObjectId(collectionId);
      const contentCollection = await contentCollectionService.findOne({ _id: new ObjectId(collectionId) });
      if (!contentCollection) {
        throw new NotFoundError("Content collection not found");
      }
      const userId = getCurrentUserId(context);
      if (!contentCollection.createdBy.equals(userId)) {
        throw new ForbiddenError("You are not allowed to access this resources");
      }
      const attributes = await attributeService.findMany({ contentCollectionId: new ObjectId(collectionId) }, { sort: { position: 1 } });
      res.status(200).json(successResponse(attributes));
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/get", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const attribute = await attributeService.getById(req.params.id);
      if (!attribute) {
        throw new NotFoundError("attribute not found");
      }
      res.status(200).json(successResponse(attribute));
    } catch (err) {
      next(err);
    }
  });

  router.post(
    "/:id/update",
    ...withDynamicFieldSettings(attributeService.collectionName, context),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const attribute = await attributeService.update(req.params.id, req.body);
        res.status(200).json(successResponse(attribute));
      } catch (err) {
        await cleanupUploadedFiles(req);
        next(err);
      }
    },
  );

  router.post("/:id/delete", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status, data } = await attributeService.delete(req.params.id);
      res.status(200).json(successResponse(data));
    } catch (err) {
      next(err);
    }
  });

  return router;
};

export default attributeController;
