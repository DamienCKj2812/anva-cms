import { Router, Request, Response, NextFunction } from "express";
import { successResponse } from "../../utils/helper.response";
import { AppContext } from "../../utils/helper.context";
import { NotFoundError } from "../../utils/helper.errors";

const publicContentController = (context: AppContext) => {
  const router = Router();
  const contentService = context.diContainer!.get("ContentService");
  const contentCollectionService = context.diContainer!.get("ContentCollectionService");

  router.get("/:slug/get-all", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { slug } = req.params;
      const contentCollection = await contentCollectionService.findOne({ slug: slug });
      if (!contentCollection) {
        throw new NotFoundError("content collection not found check the slug");
      }

      res.status(200).json(successResponse(content));
    } catch (err) {
      next(err);
    }
  });

  return router;
};

export default publicContentController;
