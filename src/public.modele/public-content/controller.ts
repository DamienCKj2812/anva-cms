import { Router, Request, Response, NextFunction } from "express";
import { errorResponse, successResponse } from "../../utils/helper.response";
import { AppContext } from "../../utils/helper.context";
import { NotFoundError } from "../../utils/helper.errors";
import { ContentCollectionTypeEnum } from "../../module/content-collection/database/models";
import { mergeTranslatableFields } from "../../utils/helper.ajv";

const publicContentController = (context: AppContext) => {
  const router = Router();
  const contentService = context.diContainer!.get("ContentService");
  const contentCollectionService = context.diContainer!.get("ContentCollectionService");
  const contentTranslationService = context.diContainer!.get("ContentTranslationService");
  const attributeService = context.diContainer!.get("AttributeService");

  router.get("/:slug/get-all", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { slug } = req.params;
      const { locale } = req.query as { locale?: string };

      const contentCollection = await contentCollectionService.findOne({ slug });
      if (!contentCollection) {
        throw new NotFoundError("Content collection not found. Check the slug.");
      }

      if (contentCollection.type === ContentCollectionTypeEnum.SINGLE) {
        const translationQuery: any = {};

        translationQuery.contentCollectionId = contentCollection._id;
        if (locale) translationQuery.locale = locale;
        else translationQuery.isDefault = true;

        const [content, contentTranslation, fullSchema] = await Promise.all([
          contentService.findOne({ contentCollectionId: contentCollection._id }),
          contentTranslationService.findOne(translationQuery),
          attributeService.getValidationSchema(contentCollection),
        ]);
        if (!content) {
          throw new NotFoundError("content not found");
        }
        if (!contentTranslation) {
          throw new NotFoundError("contentTranslation not found");
        }

        console.dir({ contentData: content.data }, { depth: null, colors: true });
        console.dir({ contentTranslationData: contentTranslation.data }, { depth: null, colors: true });
        console.dir({ fullSchema }, { depth: null, colors: true });
        const mergedData = await mergeTranslatableFields(content.data, contentTranslation.data, fullSchema);
        console.dir({ mergedData }, { depth: null, colors: true });
        return res.json(successResponse(mergedData));
      } else if (contentCollection.type === ContentCollectionTypeEnum.COLLECTION) {
        const translationQuery: any = {};
        translationQuery.contentCollectionId = contentCollection._id;
        if (locale) translationQuery.locale = locale;
        else translationQuery.isDefault = true;

        const [content, contentTranslation, fullSchemaObj] = await Promise.all([
          contentService.findMany({ contentCollectionId: contentCollection._id }, { sort: { _id: 1 } }),
          contentTranslationService.findMany(translationQuery, { sort: { contentId: 1 } }),
          attributeService.getValidationSchema(contentCollection),
        ]);

        // Wrap schema in array
        const fullSchema = {
          type: "array",
          items: fullSchemaObj,
        };

        console.dir({ contentData: content.map((c) => c.data) }, { depth: null, colors: true });
        console.dir({ contentTranslationData: contentTranslation.map((c) => c.data) }, { depth: null, colors: true });
        console.dir({ fullSchema }, { depth: null, colors: true });

        const mergedData = await mergeTranslatableFields(
          content.map((c) => c.data),
          contentTranslation.map((c) => c.data),
          fullSchema,
        );
        return res.json(successResponse(mergedData));
      }

      return res.json({ message: "Not a SINGLE content collection type" });
    } catch (err) {
      next(err);
    }
  });

  return router;
};

export default publicContentController;
