import { NextFunction, Request, Response, Router } from "express";
import { authenticate } from "../../middleware/auth";
import { NotFoundError } from "../../utils/helper.errors";
import { successResponse } from "../../utils/helper.response";
import { AppContext } from "../../utils/helper.context";
import { Permissions, requirePermission } from "../../utils/helper.permission";

const sectionContentController = (context: AppContext) => {
  const router = Router();
  const sectionContentService = context.diContainer!.get("SectionContentService");

  router.use(authenticate(context));

  router.post(
    "/:sectionContentId/update",
    requirePermission(Permissions.SECTION_CONTENT_UPDATE),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const updatedSectionContent = await sectionContentService.update(req.params.sectionContentId, req.body);
        if (!updatedSectionContent) {
          throw new NotFoundError("Section content not found");
        }
        res.status(200).json(successResponse(updatedSectionContent));
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    "/:sectionContentId/delete",
    requirePermission(Permissions.SECTION_CONTENT_DELETE),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        await sectionContentService.delete(req.params.sectionContentId);
        res.status(200).json(successResponse());
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    "/:sectionContentId/get",
    requirePermission(Permissions.SECTION_CONTENT_READ),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const sectionContent = await sectionContentService.getById(req.params.sectionContentId);
        if (!sectionContent) {
          throw new NotFoundError("Section content not found");
        }
        res.status(200).json(successResponse(sectionContent));
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    "/get-all-by-section-room-id",
    requirePermission(Permissions.SECTION_CONTENT_READ),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const sectionContents = await sectionContentService.getAllBySectionRoomId(req.body);
        res.status(200).json(successResponse(sectionContents.data, sectionContents.metadata));
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
};

export default sectionContentController;
