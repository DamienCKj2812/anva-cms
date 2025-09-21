import { Router } from "express";
import authController from "../module/auth/controller";
import organizationController from "../module/organization/controller";
import userController from "../module/user/controller";
import tenantController from "../module/tenant/controller";
import contentCollectionController from "../module/content-collection/controller";
import attributeController from "../module/attribute/controller";
import contentController from "../module/content/controller";
import mediaAssetController from "../module/media-asset/controller";

const createRouter = (context: any) => {
  const router = Router();

  router.use("/auth", authController(context));
  router.use("/user", userController(context));
  router.use("/organization", organizationController(context));
  router.use("/tenant", tenantController(context));
  router.use("/content-collection", contentCollectionController(context));
  router.use("/attribute", attributeController(context));
  router.use("/content", contentController(context));
  router.use("/media-asset", mediaAssetController(context));

  return router;
};

export default createRouter;
