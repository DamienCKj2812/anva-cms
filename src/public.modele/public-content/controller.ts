import { Router, Request, Response, NextFunction } from "express";
import { successResponse } from "../../utils/helper.response";
import { AppContext } from "../../utils/helper.context";
import { ContentCollectionTypeEnum } from "../../module/content-collection/database/models";
import { mergeTranslatableFields } from "../../utils/helper.ajv";
import { Content } from "../../module/content/database/models";

const publicContentController = (context: AppContext) => {
  const router = Router();
  const contentService = context.diContainer!.get("ContentService");
  const contentCollectionService = context.diContainer!.get("ContentCollectionService");
  const contentTranslationService = context.diContainer!.get("ContentTranslationService");
  const attributeService = context.diContainer!.get("AttributeService");
  const tenantLocaleService = context.diContainer!.get("TenantLocaleService");
  const mediaAssetService = context.diContainer!.get("MediaAssetService");

  router.get("/:slug/get-all", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { slug } = req.params;
      const { locale } = req.query as { locale?: string };

      const contentCollection = await contentCollectionService.findOne({ slug });
      if (!contentCollection) return res.json(successResponse([]));

      const defaultLocale = await tenantLocaleService.findOne({ isDefault: true });
      const requestedLocale = locale ?? defaultLocale?.locale;
      if (!requestedLocale) return res.json(successResponse([]));

      const tenantLocaleExists = await tenantLocaleService.findOne({ locale: requestedLocale });
      if (!tenantLocaleExists) return res.json(successResponse([]));

      const content: Content[] =
        contentCollection.type === ContentCollectionTypeEnum.SINGLE
          ? ([await contentService.findOne({ contentCollectionId: contentCollection._id })].filter(Boolean) as Content[])
          : ((await contentService.findMany({ contentCollectionId: contentCollection._id }, { sort: { position: 1 } })) as Content[]);

      if (!content.length) return res.json(successResponse([]));

      const translationQuery: any = { contentCollectionId: contentCollection._id, locale: requestedLocale };
      const contentTranslation: any[] =
        contentCollection.type === ContentCollectionTypeEnum.SINGLE
          ? [await contentTranslationService.findOne(translationQuery)].filter(Boolean)
          : await contentTranslationService.findMany(translationQuery);

      const localeNotFound = !contentTranslation.some((t) => t && Object.keys(t.data || {}).length > 0);

      const fullSchema = await attributeService.getValidationSchema(contentCollection);

      const translationMap = new Map(contentTranslation.map((t) => [t.contentId.toString(), t.data]));

      const mergedData = content.map((c) => mergeTranslatableFields(c.data ?? {}, translationMap.get(c._id.toString()) ?? {}, fullSchema));

      const populatedData = await mediaAssetService.populateMediaAsset(fullSchema, mergedData);

      return res.json(successResponse(populatedData));
    } catch (err) {
      next(err);
    }
  });

  return router;
};

export default publicContentController;
