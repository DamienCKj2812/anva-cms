import { Router, Request, Response, NextFunction } from "express";
import { successResponse } from "../../utils/helper.response";
import { NotFoundError } from "../../utils/helper.errors";
import { authenticate } from "../../middleware/auth";
import { cleanupUploadedFiles } from "../../utils/helper";
import { withDynamicFieldSettings } from "../../utils/helper.fieldSetting";
import { AppContext } from "../../utils/helper.context";
import { getCurrentUserId } from "../../utils/helper.auth";

const userController = (context: AppContext) => {
  const router = Router();
  const userService = context.diContainer!.get("UserService");

  router.use(authenticate(context));

  router.post(
    "/create",
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

  router.post("/get", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getCurrentUserId(context);
      const user = await userService.findOne({ _id: userId }, { projection: { password: 0 } });
      if (!user) {
        throw new NotFoundError("User not found");
      }

      res.status(200).json(successResponse(user));
    } catch (err) {
      next(err);
    }
  });

  router.post(
    "/update",
    ...withDynamicFieldSettings(userService.collectionName, context),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const updatedUser = await userService.update(req.body);
        res.status(200).json(successResponse(updatedUser));
      } catch (err) {
        await cleanupUploadedFiles(req);
        next(err);
      }
    }
  );

  router.post("/:id/delete", async (req: Request, res: Response, next: NextFunction) => {
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
