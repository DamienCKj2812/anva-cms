import { Router } from "express";
import authController from "../module/auth/controller";
import organizationController from "../module/organization/controller";
import userController from "../module/user/controller";

const createRouter = (context: any) => {
  const router = Router();

  router.use("/auth", authController(context));
  router.use("/user", userController(context));
  router.use("/organization", organizationController(context));

  return router;
};

export default createRouter;
