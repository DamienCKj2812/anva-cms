import { Router } from "express";
import authController from "../module/auth/controller";
import organizationController from "../module/organization/controller";
import userController from "../module/user/controller";
import tenantController from "../module/tenant/controller";

const createRouter = (context: any) => {
  const router = Router();

  router.use("/auth", authController(context));
  router.use("/user", userController(context));
  router.use("/organization", organizationController(context));
  router.use("/tenant", tenantController(context));

  return router;
};

export default createRouter;
