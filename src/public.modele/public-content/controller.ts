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

      // 1. Get content collection by slug
      const contentCollection = await contentCollectionService.findOne({ slug });
      if (!contentCollection) return res.json(successResponse([]));

      // 2. Resolve locale
      const defaultLocale = await tenantLocaleService.findOne({ isDefault: true });
      const requestedLocale = locale ?? defaultLocale?.locale;
      if (!requestedLocale) return res.json(successResponse([]));

      const tenantLocaleExists = await tenantLocaleService.findOne({ locale: requestedLocale });
      if (!tenantLocaleExists) return res.json(successResponse([]));

      // 3. Fetch content
      const content: Content[] =
        contentCollection.type === ContentCollectionTypeEnum.SINGLE
          ? ([await contentService.findOne({ contentCollectionId: contentCollection._id })].filter(Boolean) as Content[])
          : ((await contentService.findMany({ contentCollectionId: contentCollection._id }, { sort: { _id: 1 } })) as Content[]);

      if (!content.length) return res.json(successResponse([]));

      // 4. Fetch translations
      const translationQuery: any = { contentCollectionId: contentCollection._id, locale: requestedLocale };
      const contentTranslation: any[] =
        contentCollection.type === ContentCollectionTypeEnum.SINGLE
          ? [await contentTranslationService.findOne(translationQuery)].filter(Boolean)
          : await contentTranslationService.findMany(translationQuery, { sort: { contentId: 1 } });

      // 5. Detect missing translation
      const localeNotFound = !contentTranslation.some((t) => t && Object.keys(t.data || {}).length > 0);

      // 6. Get object schema
      const fullSchema = await attributeService.getValidationSchema(contentCollection);

      // 7. Merge per content item
      const mergedData = content.map((c, idx) =>
        mergeTranslatableFields(
          c.data ?? {}, // shared data
          contentTranslation[idx]?.data ?? {}, // translation data
          fullSchema, // object schema
        ),
      );

      const populatedData = await mediaAssetService.populateMediaAsset(fullSchema, mergedData);

      // 8. Return merged content
      return res.json(successResponse(populatedData));
    } catch (err) {
      next(err);
    }
  });

  return router;
};

export default publicContentController;
