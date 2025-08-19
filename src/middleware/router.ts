import { Router } from "express";
import authController from "../module/auth/controller";

const createRouter = (context: any) => {
  const router = Router();

  router.use("/auth", authController(context));

  return router;
};

export default createRouter;
