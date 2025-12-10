import { Router, Request, Response, NextFunction } from "express";
import { successResponse } from "../../utils/helper.response";
import { authenticate } from "../../middleware/auth";
import { cleanupUploadedFiles } from "../../utils/helper";
import { AppContext } from "../../utils/helper.context";
import { ObjectId } from "mongodb";
import { BadRequestError, NotFoundError } from "../../utils/helper.errors";

const contentController = (context: AppContext) => {
  const router = Router();
  const contentService = context.diContainer!.get("ContentService");
  const contentCollectionService = context.diContainer!.get("ContentCollectionService");
  const attributeService = context.diContainer!.get("AttributeService");

  router.use(authenticate(context));

  router.post("/:contentCollectionId/create", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const contentCollection = await contentCollectionService.findOne({ _id: new ObjectId(req.params.contentCollectionId) });
      if (!contentCollection) {
        throw new NotFoundError("content collection not found");
      }
      const fullSchema = await attributeService.getValidationSchema(contentCollection);
      const content = await contentService.create(req.body, contentCollection, fullSchema);
      res.status(201).json(successResponse(content));
    } catch (err) {
      await cleanupUploadedFiles(req);
      next(err);
    }
  });

  router.post("/:id/get", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const content = await contentService.getById(req.params.id);
      res.status(200).json(successResponse(content));
    } catch (err) {
      next(err);
    }
  });

  router.post("/:contentId/update", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { contentId } = req.params;

      if (!contentId) throw new BadRequestError('"contentId" field is required');

      const [content] = await Promise.all([contentService.findOne({ _id: new ObjectId(contentId) })]);

      if (!content) throw new NotFoundError("content not found");
      const contentCollection = await contentCollectionService.findOne({ _id: content.contentCollectionId });
      if (!contentCollection) throw new NotFoundError("contentCollection not found");

      const fullSchema = await attributeService.getValidationSchema(contentCollection);
      const updatedContent = await contentService.update(content, req.body, fullSchema);
      res.status(200).json(successResponse(updatedContent));
    } catch (err) {
      await cleanupUploadedFiles(req);
      next(err);
    }
  });

  router.post("/:id/delete", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      if (!id) throw new BadRequestError('"id" field is required');
      const [content] = await Promise.all([contentService.findOne({ _id: new ObjectId(id) })]);
      if (!content) throw new NotFoundError("content not found");
      const deletedContent = await contentService.delete(content);
      res.status(200).json(successResponse(deletedContent));
    } catch (err) {
      next(err);
    }
  });

  return router;
};

export default contentController;
