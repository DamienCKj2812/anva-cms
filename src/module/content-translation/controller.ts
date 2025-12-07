import { Router, Request, Response, NextFunction } from "express";
import { successResponse } from "../../utils/helper.response";
import { authenticate } from "../../middleware/auth";
import { cleanupUploadedFiles } from "../../utils/helper";
import { AppContext } from "../../utils/helper.context";
import { getCurrentUserId } from "../../utils/helper.auth";
import { ObjectId } from "mongodb";
import { BadRequestError, NotFoundError } from "../../utils/helper.errors";

const contentTranslationController = (context: AppContext) => {
  const router = Router();
  const contentTranslationService = context.diContainer!.get("ContentTranslationService");
  const contentCollectionService = context.diContainer!.get("ContentCollectionService");
  const contentService = context.diContainer!.get("ContentService");

  router.use(authenticate(context));

  router.post("/create", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { contentCollectionId, contentId } = req.body;

      if (!contentCollectionId) throw new BadRequestError('"contentCollectionId" field is required');
      if (!contentId) throw new BadRequestError('"contentId" field is required');

      const [contentCollection, content] = await Promise.all([
        contentCollectionService.findOne({ _id: new ObjectId(contentCollectionId) }),
        contentService.findOne({ _id: new ObjectId(contentId) }),
      ]);

      if (!contentCollection) throw new NotFoundError("contentCollection not found");
      if (!content) throw new NotFoundError("content not found");

      const contentTranslation = await contentTranslationService.create(req.body, contentCollection, content);

      res.status(201).json(successResponse(contentTranslation));
    } catch (err) {
      await cleanupUploadedFiles(req);
      next(err);
    }
  });

  router.post("/list", async (req, res, next) => {
    try {
      const userId = getCurrentUserId(context);
      const { filter = {}, lookup } = req.body;

      const match: any = {};

      if (filter._id) {
        match._id = new ObjectId(filter._id);
      }

      if (filter.contentCollectionId) {
        match.contentCollectionId = new ObjectId(filter.contentCollectionId);
      }

      if (filter.contentId) {
        match.contentId = new ObjectId(filter.contentId);
      }

      if (filter.locale) {
        match.locale = filter.locale;
      }

      match.createdBy = userId;

      const contents = await contentTranslationService.list({
        match,
        lookup: Array.isArray(lookup) ? lookup : undefined,
      });

      res.status(200).json(successResponse(contents));
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/get", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const contentTranslation = await contentTranslationService.getById(req.params.id);
      res.status(200).json(successResponse(contentTranslation));
    } catch (err) {
      next(err);
    }
  });

  // router.post("/:id/update", async (req: Request, res: Response, next: NextFunction) => {
  // try {
  //    const updatedContentTranslation = await contentTranslationService.update(req.params.id, req.body);
  //   res.status(200).json(successResponse(updatedContentTranslation));
  // } catch (err) {
  //   await cleanupUploadedFiles(req);
  //  next(err);
  //}
  //});

  router.post("/:id/delete", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const deletedContentTranslation = await contentTranslationService.delete(req.params.id);
      res.status(200).json(successResponse(deletedContentTranslation));
    } catch (err) {
      next(err);
    }
  });

  return router;
};

export default contentTranslationController;
