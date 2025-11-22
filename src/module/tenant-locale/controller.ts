import { Router, Request, Response, NextFunction } from "express";
import { successResponse } from "../../utils/helper.response";
import { NotFoundError } from "../../utils/helper.errors";
import { authenticate } from "../../middleware/auth";
import { cleanupUploadedFiles } from "../../utils/helper";
import { AppContext } from "../../utils/helper.context";
import { getCurrentUserId } from "../../utils/helper.auth";
import { ObjectId } from "mongodb";

const tenantLocaleController = (context: AppContext) => {
  const router = Router();
  const tenantLocaleService = context.diContainer!.get("TenantLocaleService");

  router.use(authenticate(context));

  router.post("/create", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantLocale = await tenantLocaleService.create({ data: req.body });
      res.json(successResponse(tenantLocale));
    } catch (err) {
      await cleanupUploadedFiles(req);
      next(err);
    }
  });

  router.post("/get", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getCurrentUserId(context);
      const tenantLocales = await tenantLocaleService.findMany({
        createdBy: userId,
      });
      res.json(successResponse(tenantLocales));
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
