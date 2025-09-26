import { Router, Request, Response, NextFunction } from "express";
import { successResponse } from "../../utils/helper.response";
import { NotFoundError } from "../../utils/helper.errors";
import { authenticate } from "../../middleware/auth";
import { cleanupUploadedFiles } from "../../utils/helper";
import { withDynamicFieldSettings } from "../../utils/helper.fieldSetting";
import { AppContext } from "../../utils/helper.context";

const organizationController = (context: AppContext) => {
  const router = Router();
  const organizationService = context.diContainer!.get("OrganizationService");

  router.use(authenticate(context));

  router.post(
    "/create",
    ...withDynamicFieldSettings(organizationService.collectionName, context),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        console.log("Creating organization with data:", req.body);
        const user = await organizationService.create(req.body);
        res.status(201).json(successResponse(user));
      } catch (err) {
        await cleanupUploadedFiles(req);
        next(err);
      }
    }
  );

  router.post("/:id/get", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await organizationService.getById(req.params.id);
      if (!user) {
        throw new NotFoundError("organization not found");
      }

      res.status(200).json(successResponse(user));
    } catch (err) {
      next(err);
    }
  });

  return router;
};

export default organizationController;
