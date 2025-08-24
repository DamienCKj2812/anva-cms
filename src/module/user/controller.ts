import { Router, Request, Response, NextFunction } from "express";
import { successResponse } from "../../utils/helper.response";
import { Permissions, requirePermission } from "../../utils/helper.permission";
import { NotFoundError } from "../../utils/helper.errors";
import { authenticate } from "../../middleware/auth";
import { cleanupUploadedFiles } from "../../utils/helper";
import { withDynamicFieldSettings } from "../../utils/helper.fieldSetting";
import { AppContext } from "../../utils/helper.context";

const userController = (context: AppContext) => {
  const router = Router();
  const userService = context.diContainer!.get("UserService");

  router.use(authenticate(context));

  router.post(
    "/create",
    requirePermission(context, Permissions.USER_CREATE),
    ...withDynamicFieldSettings(userService.collectionName, context),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        console.log("Creating user with data:", req.body);
        const user = await userService.create(req.body);
        res.status(201).json(successResponse(user));
      } catch (err) {
        await cleanupUploadedFiles(req);
        next(err);
      }
    }
  );

  router.post("/get", requirePermission(context, Permissions.USER_READ_ALL), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { data, metadata } = await userService.getAll({
        ...req.body,
      });
      res.status(200).json(successResponse(data, metadata));
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/get", requirePermission(context, Permissions.USER_READ), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await userService.getById(req.params.id);
      if (!user) {
        throw new NotFoundError("User not found");
      }

      res.status(200).json(successResponse(user));
    } catch (err) {
      next(err);
    }
  });

  router.post(
    "/:id/update",
    requirePermission(context, Permissions.USER_UPDATE),
    ...withDynamicFieldSettings(userService.collectionName, context),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const updatedUser = await userService.update(req.params.id, req.body);
        res.status(200).json(successResponse(updatedUser));
      } catch (err) {
        await cleanupUploadedFiles(req);
        next(err);
      }
    }
  );

  router.post("/:id/delete", requirePermission(context, Permissions.USER_DELETE), async (req: Request, res: Response, next: NextFunction) => {
    try {
      await userService.delete(req.params.id);
      res.status(200).json(successResponse());
    } catch (err) {
      next(err);
    }
  });

  return router;
};

export default userController;
