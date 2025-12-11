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
  const attributeService = context.diContainer!.get("AttributeService");
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

  router.post("/:attributeComponentId/update", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { attributeComponentId } = req.params;
      const attributeComponent = await attributeComponentService.findOne({ _id: new ObjectId(attributeComponentId) });
      if (!attributeComponent) {
        throw new ValidationError("attributeComponent not found");
      }
      const attribute = await attributeComponentService.update(req.body, attributeComponent);
      res.status(201).json(successResponse(attribute));
    } catch (err) {
      next(err);
    }
  });

  router.post("/:attributeComponentId/delete", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { attributeComponentId } = req.params;
      const attributeComponent = await attributeComponentService.findOne({ _id: new ObjectId(attributeComponentId) });
      if (!attributeComponent) {
        throw new ValidationError("attributeComponent not found");
      }
      const attribute = await attributeComponentService.delete(attributeComponent);
      res.status(201).json(successResponse(attribute));
    } catch (err) {
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

  router.post("/:attributeComponentId/add-attribute", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const [existingAttributeComponent] = await Promise.all([
        attributeComponentService.findOne({ _id: new ObjectId(req.params.attributeComponentId) }),
      ]);
      if (!existingAttributeComponent) {
        throw new NotFoundError("existingAttributeComponent not found");
      }
      const attributeComponent = await attributeComponentService.addAttributeInComponent(req.body, existingAttributeComponent);
      if (!attributeComponent) {
        throw new NotFoundError("attribute component not found");
      }
      res.status(200).json(successResponse(attributeComponent));
    } catch (err) {
      next(err);
    }
  });

  router.post("/:attributeId/update-attribute", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { attributeId } = req.params;
      const attribute = await attributeService.findOne({ _id: new ObjectId(attributeId) });
      if (!attribute) {
        throw new NotFoundError("attribute not found");
      }
      const attributeComponent = await attributeComponentService.findOne({ _id: attribute.componentRefId });
      if (!attributeComponent) {
        throw new NotFoundError("attributeComponent not found");
      }
      const updatedComponent = await attributeComponentService.updateAttributeInComponent(req.body, attribute, attributeComponent);

      res.status(200).json(successResponse(updatedComponent));
    } catch (err) {
      next(err);
    }
  });

  router.post("/:attributeId/delete-attribute", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { attributeId } = req.params;
      const attribute = await attributeService.findOne({ _id: new ObjectId(attributeId) });
      if (!attribute) {
        throw new NotFoundError("attribute not found");
      }
      const attributeComponent = await attributeComponentService.findOne({ _id: attribute.componentRefId });
      if (!attributeComponent) {
        throw new NotFoundError("attributeComponent not found");
      }
      const updatedComponent = await attributeComponentService.deleteAttributeInComponent(attribute, attributeComponent);

      res.status(200).json(successResponse(updatedComponent));
    } catch (err) {
      next(err);
    }
  });

  return router;
};

export default attributeComponentController;
