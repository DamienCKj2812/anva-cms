import { Router, Request, Response, NextFunction } from "express";
import { successResponse } from "../../utils/helper.response";
import { Permissions, requirePermission } from "../../utils/helper.permission";
import { NotFoundError } from "../../utils/helper.errors";
import { authenticate } from "../../middleware/auth";
import { cleanupUploadedFiles } from "../../utils/helper";
import { withDynamicFieldSettings } from "../../utils/helper.fieldSetting";
import { AppContext } from "../../utils/helper.context";

const profileController = (context: AppContext) => {
  const router = Router();
  const profileService = context.diContainer!.get("ProfileService");

  router.use(authenticate(context));

  router.post(
    "/create",
    requirePermission(Permissions.PROFILE_CREATE),
    ...withDynamicFieldSettings(profileService.collectionName, context),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        console.log("Creating user with data:", req.body);
        const profile = await profileService.create(req.body);
        res.status(201).json(successResponse(profile));
      } catch (err) {
        await cleanupUploadedFiles(req);
        next(err);
      }
    }
  );

  router.post("/get", requirePermission(Permissions.PROFILE_READ_ALL), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { data, metadata } = await profileService.getAll({
        ...req.body,
      });
      res.status(200).json(successResponse(data, metadata));
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/get", requirePermission(Permissions.PROFILE_READ), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const profile = await profileService.getById(req.params.id);
      if (!profile) {
        throw new NotFoundError("User not found");
      }

      res.status(200).json(successResponse(profile));
    } catch (err) {
      next(err);
    }
  });

  router.post(
    "/:id/update",
    requirePermission(Permissions.PROFILE_UPDATE),
    ...withDynamicFieldSettings(profileService.collectionName, context),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const updatedProfile = await profileService.update(req.params.id, req.body);

        res.status(200).json(successResponse(updatedProfile));
      } catch (err) {
        await cleanupUploadedFiles(req);
        next(err);
      }
    }
  );

  router.post("/:id/delete", requirePermission(Permissions.PROFILE_DELETE), async (req: Request, res: Response, next: NextFunction) => {
    try {
      await profileService.delete(req.params.id);

      res.status(200).json(successResponse());
    } catch (err) {
      next(err);
    }
  });

  return router;
};

export default profileController;
