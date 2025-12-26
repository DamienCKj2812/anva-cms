import { Router, Request, Response, NextFunction } from "express";
import { successResponse } from "../../utils/helper.response";
import { NotFoundError } from "../../utils/helper.errors";
import { authenticate } from "../../middleware/auth";
import { cleanupUploadedFiles } from "../../utils/helper";
import { AppContext } from "../../utils/helper.context";
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

  router.post("/get", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getCurrentUserId(context);
      const { tenantId, contentCollectionId } = req.query as { tenantId?: string; contentCollectionId?: string };
      const filter: any = {
        createdBy: new ObjectId(userId),
      };
      if (tenantId) {
        filter.tenantId = new ObjectId(tenantId);
      }
      if (contentCollectionId) {
        filter.contentCollectionId = new ObjectId(contentCollectionId);
      }
      const attributes = await attributeService.findMany(filter, { sort: { position: 1 } });
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

  router.post("/:id/update-primitive", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const attribute = await attributeService.getById(id);
      if (!attribute) {
        throw new NotFoundError("attribute not found");
      }
      const contentCollection = await contentCollectionService.findOne({ _id: attribute.contentCollectionId });
      if (!contentCollection) {
        throw new NotFoundError("contentCollection not found");
      }
      const updatedAttribute = await attributeService.updatePrimitiveAttribute(attribute, req.body, contentCollection);
      res.status(200).json(successResponse(updatedAttribute));
    } catch (err) {
      await cleanupUploadedFiles(req);
      next(err);
    }
  });

  router.post("/:id/update-component", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const attribute = await attributeService.getById(id);
      if (!attribute) {
        throw new NotFoundError("attribute not found");
      }
      const contentCollection = await contentCollectionService.findOne({ _id: attribute.contentCollectionId });
      if (!contentCollection) {
        throw new NotFoundError("contentCollection not found");
      }
      const updatedAttribute = await attributeService.updateComponentAttribute(attribute, req.body, contentCollection);
      res.status(200).json(successResponse(updatedAttribute));
    } catch (err) {
      await cleanupUploadedFiles(req);
      next(err);
    }
  });

  router.post("/:id/delete", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const attribute = await attributeService.getById(id);
      if (!attribute) {
        throw new NotFoundError("attribute not found");
      }
      const contentCollection = await contentCollectionService.findOne({ _id: attribute.contentCollectionId });
      if (!contentCollection) {
        throw new NotFoundError("contentCollection not found");
      }
      const { status, data } = await attributeService.delete(attribute, contentCollection);
      res.status(200).json(successResponse(data));
    } catch (err) {
      next(err);
    }
  });

  return router;
};

export default attributeController;
