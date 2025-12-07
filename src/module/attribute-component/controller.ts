import { Router, Request, Response, NextFunction } from "express";
import { successResponse } from "../../utils/helper.response";
import { NotFoundError, ValidationError } from "../../utils/helper.errors";
import { authenticate } from "../../middleware/auth";
import { cleanupUploadedFiles } from "../../utils/helper";
import { AppContext } from "../../utils/helper.context";
import { ObjectId } from "mongodb";

const attributeComponentController = (context: AppContext) => {
  const router = Router();
  const attributeComponentService = context.diContainer!.get("AttributeComponentService");
  const contentCollectionService = context.diContainer!.get("ContentCollectionService");
  const tenantService = context.diContainer!.get("TenantService");

  router.use(authenticate(context));

  router.post("/:tenantId/create", async (req: Request, res: Response, next: NextFunction) => {
    try {
      console.log("Creating attribute with data:", req.body);
      const tenant = await tenantService.findOne({ _id: new ObjectId(req.params.tenantId) });
      if (!tenant) {
        throw new ValidationError("tenant not found");
      }
      const attribute = await attributeComponentService.create(req.body, tenant);
      res.status(201).json(successResponse(attribute));
    } catch (err) {
      await cleanupUploadedFiles(req);
      next(err);
    }
  });

  router.post("/:id/get", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const attributeComponent = await attributeComponentService.getById(req.params.id);
      if (!attributeComponent) {
        throw new NotFoundError("attribute component not found");
      }
      res.status(200).json(successResponse(attributeComponent));
    } catch (err) {
      next(err);
    }
  });

  router.post("/:contentCollectionId/:attributeComponentId/add-attribute", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const [contentCollection, existingAttributeComponent] = await Promise.all([
        contentCollectionService.findOne({ _id: new ObjectId(req.params.contentCollectionId) }),
        attributeComponentService.findOne({ _id: new ObjectId(req.params.attributeComponentId) }),
      ]);
      if (!contentCollection) {
        throw new NotFoundError("content collection not found");
      }
      if (!existingAttributeComponent) {
        throw new NotFoundError("existingAttributeComponent not found");
      }
      const attributeComponent = await attributeComponentService.addAttribute(req.body, contentCollection, existingAttributeComponent);
      if (!attributeComponent) {
        throw new NotFoundError("attribute component not found");
      }
      res.status(200).json(successResponse(attributeComponent));
    } catch (err) {
      next(err);
    }
  });

  return router;
};

export default attributeComponentController;
