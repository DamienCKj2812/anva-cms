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

      // Check if any attributes are localizable
      const hasLocalizableAttributes = await attributeService.getCollection().findOne({ 
        contentCollectionId: contentCollection._id,
        localizable : true
      });
  
      if (contentCollection.type === ContentCollectionTypeEnum.SINGLE) {
        const content = await contentService.findOne({ 
          contentCollectionId: contentCollection._id 
        });
        
        if (!content) {
          throw new NotFoundError("content not found");
        }

        // If no localizable attributes, return content data directly
        if (!hasLocalizableAttributes) {
          return res.json(successResponse(content.data));
        }

        // If has localizable attributes, fetch and merge translation
        const fullSchema = await attributeService.getValidationSchema(contentCollection);
        const translationQuery: any = {
          contentCollectionId: contentCollection._id
        };
        if (locale) translationQuery.locale = locale;
        else translationQuery.isDefault = true;

        const contentTranslation = await contentTranslationService.findOne(translationQuery);
        
        if (!contentTranslation) {
          throw new NotFoundError("contentTranslation not found");
        }

        const mergedData = await mergeTranslatableFields(
          content.data, 
          contentTranslation.data, 
          fullSchema
        );
        return res.json(successResponse(mergedData));
        
      } else if (contentCollection.type === ContentCollectionTypeEnum.COLLECTION) {
        const content = await contentService.findMany(
          { contentCollectionId: contentCollection._id }, 
          { sort: { _id: 1 } }
        );

        // If no localizable attributes, return content data directly
        if (!hasLocalizableAttributes) {
          return res.json(successResponse(content.map((c) => c.data)));
        }

        // If has localizable attributes, fetch and merge translations
        const fullSchemaObj = await attributeService.getValidationSchema(contentCollection);
        const translationQuery: any = {
          contentCollectionId: contentCollection._id
        };
        if (locale) translationQuery.locale = locale;
        else translationQuery.isDefault = true;

        const contentTranslation = await contentTranslationService.findMany(
          translationQuery, 
          { sort: { contentId: 1 } }
        );

        const fullSchema = {
          type: "array",
          items: fullSchemaObj,
        };

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