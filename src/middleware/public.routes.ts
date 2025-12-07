import { Router } from "express";
import publicContentController from "../public.modele/public-content/controller";

const createPublicRouter = (context: any) => {
  const router = Router();

  router.use("/content", publicContentController(context));

  return router;
};

export default createPublicRouter;
