import { Router, Request, Response, NextFunction } from "express";
import { successResponse } from "../../utils/helper.response";
import { NotFoundError } from "../../utils/helper.errors";
import { authenticate } from "../../middleware/auth";
import { cleanupUploadedFiles } from "../../utils/helper";
import { withDynamicFieldSettings } from "../../utils/helper.fieldSetting";
import { AppContext } from "../../utils/helper.context";

const tenantController = (context: AppContext) => {
  const router = Router();
  const tenantService = context.diContainer!.get("TenantService");

  router.use(authenticate(context));

  router.post("/create", async (req: Request, res: Response, next: NextFunction) => {
    try {
      console.log("Creating tenant with data:", req.body);
      const tenant = await tenantService.create(req.body);
      res.status(201).json(successResponse(tenant));
    } catch (err) {
      await cleanupUploadedFiles(req);
      next(err);
    }
  });

  router.post("/get", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { data, metadata } = await tenantService.getAll({
        ...req.body,
      });
      res.status(200).json(successResponse(data, metadata));
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/get", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenant = await tenantService.getById(req.params.id);
      if (!tenant) {
        throw new NotFoundError("tenant not found");
      }

      res.status(200).json(successResponse(tenant));
    } catch (err) {
      next(err);
    }
  });

  router.post(
    "/:id/update",
    ...withDynamicFieldSettings(tenantService.collectionName, context),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const updatedTenant = await tenantService.update(req.params.id, req.body);
        res.status(200).json(successResponse(updatedTenant));
      } catch (err) {
        await cleanupUploadedFiles(req);
        next(err);
      }
    }
  );

  return router;
};

export default tenantController;
