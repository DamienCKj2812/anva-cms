import { Router, Request, Response, NextFunction } from "express";
import { successResponse } from "../../utils/helper.response";
import { NotFoundError, ValidationError } from "../../utils/helper.errors";
import { authenticate } from "../../middleware/auth";
import { cleanupUploadedFiles } from "../../utils/helper";
import { AppContext } from "../../utils/helper.context";
import { getCurrentUserId } from "../../utils/helper.auth";
import { ObjectId } from "mongodb";

const tenantLocaleController = (context: AppContext) => {
  const router = Router();
  const tenantLocaleService = context.diContainer!.get("TenantLocaleService");
  const tenantService = context.diContainer!.get("TenantService");

  router.use(authenticate(context));

  router.post("/:tenantId/create", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId } = req.params;
      if (!tenantId) {
        throw new ValidationError('"tenantId" field is required');
      }
      const existingTenant = await tenantService.findOne({
        _id: new ObjectId(tenantId),
      });
      if (!existingTenant) {
        throw new NotFoundError("Tenant not found");
      }
      const tenantLocale = await tenantLocaleService.create({ data: req.body, tenant: existingTenant });
      res.json(successResponse(tenantLocale));
    } catch (err) {
      await cleanupUploadedFiles(req);
      next(err);
    }
  });

  router.post("/get", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getCurrentUserId(context);
      const { tenantId } = req.query as { tenantId?: string };
      const filter: any = {
        createdBy: new ObjectId(userId),
      };
      if (tenantId) {
        filter.tenantId = new ObjectId(tenantId);
      }
      const contents = await tenantLocaleService.findMany(filter);
      res.status(200).json(successResponse(contents));
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/get", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getCurrentUserId(context);
      const tenantLocale = await tenantLocaleService.findOne({ _id: new ObjectId(req.params.id), createdBy: userId });
      if (!tenantLocale) {
        throw new NotFoundError("tenantLocale not found");
      }

      res.json(successResponse(tenantLocale));
    } catch (err) {
      next(err);
    }
  });

  router.post("/:contentId/get-existing-locales", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updatedtenantLocaleLocale = await tenantLocaleService.getRemainingLocales(req.params.contentId);
      res.json(successResponse(updatedtenantLocaleLocale));
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/update", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updatedtenantLocaleLocale = await tenantLocaleService.update(req.params.id, req.body);
      res.json(successResponse(updatedtenantLocaleLocale));
    } catch (err) {
      next(err);
    }
  });

  return router;
};

export default tenantLocaleController;
