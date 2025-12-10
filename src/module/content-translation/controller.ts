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
  const tenantLocaleService = context.diContainer!.get("TenantLocaleService");
  const attributeService = context.diContainer!.get("AttributeService");

  router.use(authenticate(context));

  router.post("/:tenantLocaleId/:contentCollectionId/:contentId/create", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantLocaleId, contentCollectionId, contentId } = req.params;

      if (!contentCollectionId) throw new BadRequestError('"contentCollectionId" field is required');
      if (!contentId) throw new BadRequestError('"contentId" field is required');

      const [contentCollection, content, tenantLocale] = await Promise.all([
        contentCollectionService.findOne({ _id: new ObjectId(contentCollectionId) }),
        contentService.findOne({ _id: new ObjectId(contentId) }),
        tenantLocaleService.findOne({ _id: new ObjectId(tenantLocaleId) }),
      ]);

      if (!contentCollection) throw new NotFoundError("contentCollection not found");
      if (!content) throw new NotFoundError("content not found");
      if (!tenantLocale) throw new NotFoundError("tenantLocale not found");
      const fullSchema = await attributeService.getValidationSchema(contentCollection);

      const contentTranslation = await contentTranslationService.create(req.body, contentCollection, content, tenantLocale, fullSchema);

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

  router.post("/:id/update", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const contentTranslation = await contentTranslationService.findOne({ _id: new ObjectId(id) });
      if (!contentTranslation) throw new NotFoundError("contentTranslation not found");
      const [contentCollection, content] = await Promise.all([
        contentCollectionService.findOne({ _id: contentTranslation.contentCollectionId }),
        contentService.findOne({ _id: contentTranslation.contentId }),
      ]);
      if (!contentCollection) throw new NotFoundError("contentCollection not found");
      if (!content) throw new NotFoundError("content not found");
      const fullSchema = await attributeService.getValidationSchema(contentCollection);

      const updatedContentTranslation = await contentTranslationService.update(req.body, contentTranslation, contentCollection, content, fullSchema);

      res.status(200).json(successResponse(updatedContentTranslation));
    } catch (err) {
      await cleanupUploadedFiles(req);
      next(err);
    }
  });

  router.post("/:id/delete", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      if (!id) throw new BadRequestError('"id" field is required');
      const [contentTranslation] = await Promise.all([contentTranslationService.findOne({ _id: new ObjectId(id) })]);
      if (!contentTranslation) throw new NotFoundError("contentTranslation not found");
      const deletedContentTranslation = await contentTranslationService.delete(contentTranslation);
      res.status(200).json(successResponse(deletedContentTranslation));
    } catch (err) {
      next(err);
    }
  });

  return router;
};

export default contentTranslationController;
