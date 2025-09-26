import { Router, Request, Response, NextFunction } from "express";
import { errorResponse, successResponse } from "../../utils/helper.response";
import { requirePermission } from "../../utils/helper.permission";
import { NotFoundError } from "../../utils/helper.errors";
import { authenticate } from "../../middleware/auth";
import { cleanupUploadedFiles } from "../../utils/helper";
import { withDynamicFieldSettings } from "../../utils/helper.fieldSetting";
import { AppContext } from "../../utils/helper.context";

const attributeController = (context: AppContext) => {
  const router = Router();
  const attributeService = context.diContainer!.get("AttributeService");

  router.use(authenticate(context));

  router.post("/create", async (req: Request, res: Response, next: NextFunction) => {
    try {
      console.log("Creating attribute with data:", req.body);
      const attribute = await attributeService.create(req.body);
      res.status(201).json(successResponse(attribute));
    } catch (err) {
      await cleanupUploadedFiles(req);
      next(err);
    }
  });

  router.post("/get", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { data, metadata } = await attributeService.getAll({
        ...req.body,
      });
      res.status(200).json(successResponse(data, metadata));
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
    }
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
