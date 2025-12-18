import { Router, Request, Response, NextFunction } from "express";
import { successResponse } from "../../utils/helper.response";
import { authenticate } from "../../middleware/auth";
import { cleanupUploadedFiles } from "../../utils/helper";
import { AppContext } from "../../utils/helper.context";
import { ObjectId } from "mongodb";
import { BadRequestError, NotFoundError } from "../../utils/helper.errors";
import { ContentCollectionTypeEnum } from "../content-collection/database/models";
import { mergeTranslatableFields } from "../../utils/helper.ajv";
import { Content, FullContent } from "./database/models";

const contentController = (context: AppContext) => {
  const router = Router();
  const contentService = context.diContainer!.get("ContentService");
  const contentTranslationService = context.diContainer!.get("ContentTranslationService");
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

  router.post("/:contentCollectionId/get-all-with-translation", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { contentCollectionId } = req.params;
      const { locale, contentId } = req.query as { locale?: string; contentId?: string };

      const collectionObjectId = new ObjectId(contentCollectionId);

      const contentCollection = await contentCollectionService.findOne({ _id: collectionObjectId });
      if (!contentCollection) {
        throw new NotFoundError("Content collection not found.");
      }

      const matchContentQuery: any = { contentCollectionId: collectionObjectId };
      if (contentId) matchContentQuery._id = new ObjectId(contentId);

      const matchTranslationQuery: any = { contentCollectionId: collectionObjectId };
      if (contentId) matchTranslationQuery.contentId = new ObjectId(contentId);
      if (locale) matchTranslationQuery.locale = locale;
      else matchTranslationQuery.isDefault = true;

      // Fetch content
      const content: Content[] =
        contentCollection.type === ContentCollectionTypeEnum.SINGLE
          ? [(await contentService.findOne(matchContentQuery)) as Content]
          : ((await contentService.findMany(matchContentQuery, { sort: { _id: 1 } })) as Content[]);

      if (!content || content.length === 0) throw new NotFoundError("Content not found");

      // Fetch translations
      const contentTranslation =
        contentCollection.type === ContentCollectionTypeEnum.SINGLE
          ? [await contentTranslationService.findOne(matchTranslationQuery)]
          : await contentTranslationService.findMany(matchTranslationQuery, { sort: { contentId: 1 } });

      const fullSchema =
        contentCollection.type === ContentCollectionTypeEnum.COLLECTION
          ? { type: "array", items: await attributeService.getValidationSchema(contentCollection) }
          : await attributeService.getValidationSchema(contentCollection);

      // Merge translations properly
      const mergedData = await mergeTranslatableFields(
        content.map((c) => c?.data),
        contentTranslation.map((t) => t?.data || {}), // handle missing translations
        fullSchema,
      );

      // Map merged data into FullContent objects
      const fullContents: FullContent[] = content.map((c, idx) => ({
        ...c,
        fullData: mergedData[idx],
      }));

      return res.json(successResponse(fullContents));
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
