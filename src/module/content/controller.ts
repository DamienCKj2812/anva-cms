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
  const tenantLocaleService = context.diContainer!.get("TenantLocaleService");
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

  router.post("/:contentCollectionId/get-all-with-translation", async (req, res, next) => {
    try {
      const { contentCollectionId } = req.params;
      const { locale, contentId } = req.query as { locale?: string; contentId?: string };

      const collectionObjectId = new ObjectId(contentCollectionId);

      const contentCollection = await contentCollectionService.findOne({ _id: collectionObjectId });
      if (!contentCollection) return res.json(successResponse([]));

      const defaultLocale = await tenantLocaleService.findOne({ isDefault: true });
      const requestedLocale = locale ?? defaultLocale?.locale;
      if (!requestedLocale) return res.json(successResponse([]));

      const tenantLocaleExists = await tenantLocaleService.findOne({ locale: requestedLocale });
      if (!tenantLocaleExists) return res.json(successResponse([]));

      const matchContentQuery: any = { contentCollectionId: collectionObjectId };
      if (contentId) matchContentQuery._id = new ObjectId(contentId);

      const content: Content[] =
        contentCollection.type === ContentCollectionTypeEnum.SINGLE
          ? ([await contentService.findOne(matchContentQuery)].filter(Boolean) as Content[])
          : ((await contentService.findMany(matchContentQuery, { sort: { position: 1 } })) as Content[]);

      if (!content.length) return res.json(successResponse([]));

      const buildTranslationQuery = (locale: string) => {
        const q: any = { contentCollectionId: collectionObjectId, locale };
        if (contentId) q.contentId = new ObjectId(contentId);
        return q;
      };

      const contentTranslation: any[] =
        contentCollection.type === ContentCollectionTypeEnum.SINGLE
          ? [await contentTranslationService.findOne(buildTranslationQuery(requestedLocale))].filter(Boolean)
          : await contentTranslationService.findMany(buildTranslationQuery(requestedLocale));

      const localeNotFound = !contentTranslation.some((t) => t != null);

      const fullSchema = await attributeService.getValidationSchema(contentCollection);

      const translationMap = new Map(contentTranslation.map((t) => [t.contentId.toString(), t.data]));

      const mergedData = content.map((c) => mergeTranslatableFields(c.data ?? {}, translationMap.get(c._id.toString()) ?? {}, fullSchema));

      const fullContents: FullContent[] = content.map((c, idx) => ({
        ...c,
        requestedLocale,
        resolvedLocale: requestedLocale,
        localeNotFound,
        tenantLocale: tenantLocaleExists,
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

  router.post("/:contentCollectionId/update-position", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const contentCollection = await contentCollectionService.findOne({ _id: new ObjectId(req.params.contentCollectionId) });
      if (!contentCollection) {
        throw new NotFoundError("content collection not found");
      }
      const content = await contentService.updatePosition(req.body, contentCollection);
      res.status(201).json(successResponse(content));
    } catch (err) {
      next(err);
    }
  });

  return router;
};

export default contentController;
