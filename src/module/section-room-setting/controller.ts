import { NextFunction, Request, Response, Router } from "express";
import { authenticate } from "../../middleware/auth";
import { successResponse } from "../../utils/helper.response";
import { InternalServerError, NotFoundError } from "../../utils/helper.errors";
import { AppContext } from "../../utils/helper.context";
import { Permissions, requirePermission } from "../../utils/helper.permission";

const sectionRoomSettingController = (context: AppContext) => {
  const router = Router();
  const sectionRoomSettingService = context.diContainer!.get("SectionRoomSettingService");

  router.use(authenticate(context));

  router.post(
    "/:sectionId/get-all-by-section-id",
    requirePermission(Permissions.SECTION_ROOM_SETTING_READ),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const sectionRoomSettings = await sectionRoomSettingService.getAllBySectionId(req.params.sectionId);
        res.status(200).json(successResponse(sectionRoomSettings.data, sectionRoomSettings.metadata));
      } catch (err) {
        next(err);
      }
    }
  );

  router.post("/create", requirePermission(Permissions.SECTION_ROOM_SETTING_CREATE), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updateSectionRoomSetting = await sectionRoomSettingService.create(req.body);
      if (!updateSectionRoomSetting) {
        throw new InternalServerError("Section room setting not created");
      }
      res.status(200).json(successResponse(updateSectionRoomSetting));
    } catch (err) {
      next(err);
    }
  });

  router.post(
    "/:sectionRoomSettingId/get",
    requirePermission(Permissions.SECTION_ROOM_SETTING_READ),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const sectionRoomSetting = await sectionRoomSettingService.getById(req.params.sectionRoomSettingId);
        if (!sectionRoomSetting) {
          throw new NotFoundError("section room setting not found");
        }
        res.status(200).json(successResponse(sectionRoomSetting));
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    "/:sectionRoomSettingId/update",
    requirePermission(Permissions.SECTION_ROOM_SETTING_UPDATE),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const updatedSectionRoomSetting = await sectionRoomSettingService.update(req.params.sectionRoomSettingId, req.body);
        if (!updatedSectionRoomSetting) {
          throw new InternalServerError("Section room setting not updated");
        }
        res.status(200).json(successResponse(updatedSectionRoomSetting));
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    "/update-position",
    requirePermission(Permissions.SECTION_ROOM_SETTING_UPDATE),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const positionData = await sectionRoomSettingService.updatePosition(req.body);
        if (!positionData) {
          throw new InternalServerError("Failed to update position");
        }
        res.status(200).json(successResponse(positionData));
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    "/:sectionRoomSettingId/add-reference",
    requirePermission(Permissions.SECTION_ROOM_SETTING_UPDATE),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const references = await sectionRoomSettingService.addReferences(req.params.sectionRoomSettingId, req.body);
        if (!references) {
          throw new InternalServerError("Failed to add reference");
        }
        res.status(200).json(successResponse(references));
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    "/:sectionRoomSettingId/update-full-reference-list",
    requirePermission(Permissions.SECTION_ROOM_SETTING_UPDATE),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const sectionRoomSetting = await sectionRoomSettingService.updateFullReferencesList(req.params.sectionRoomSettingId, req.body);
        if (!sectionRoomSetting) {
          throw new InternalServerError("Failed to update the full references");
        }
        res.status(200).json(successResponse(sectionRoomSetting));
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    "/:sectionRoomSettingId/get-with-references-details",
    requirePermission(Permissions.SECTION_READ),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const sections = await sectionRoomSettingService.getWithReferences(req.params.sectionRoomSettingId);
        res.status(200).json(successResponse(sections.data, sections.metadata));
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    "/:sectionId/get-all-with-references-by-section-id",
    requirePermission(Permissions.SECTION_READ),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const sections = await sectionRoomSettingService.getAllWithReferencesBySectionId(req.params.sectionId);
        res.status(200).json(successResponse(sections.data, sections.metadata));
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
};

export default sectionRoomSettingController;
