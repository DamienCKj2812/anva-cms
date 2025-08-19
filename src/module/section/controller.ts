import { Router, Request, Response, NextFunction } from "express";
import { authenticate } from "../../middleware/auth";
import { successResponse } from "../../utils/helper.response";
import { NotFoundError } from "../../utils/helper.errors";
import { AppContext } from "../../utils/helper.context";
import { Permissions, requirePermission } from "../../utils/helper.permission";

const sectionController = (context: AppContext) => {
  const router = Router();
  const sectionService = context.diContainer!.get("SectionService");

  router.use(authenticate(context));

  router.post("/create", requirePermission(Permissions.SECTION_CREATE), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const section = await sectionService.create(req.body);
      res.status(201).json(successResponse(section));
    } catch (err) {
      next(err);
    }
  });

  router.post("/:sectionId/update", requirePermission(Permissions.SECTION_UPDATE), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updatedSection = await sectionService.update(req.params.sectionId, req.body);
      res.status(200).json(successResponse(updatedSection));
    } catch (err) {
      next(err);
    }
  });

  router.post("/:sectionId/delete", requirePermission(Permissions.SECTION_DELETE), async (req: Request, res: Response, next: NextFunction) => {
    try {
      await sectionService.delete(req.params.sectionId);
      res.status(200).json(successResponse());
    } catch (err) {
      next(err);
    }
  });

  router.post("/:sectionId/get", requirePermission(Permissions.SECTION_READ), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const section = await sectionService.getById(req.params.sectionId);
      if (!section) {
        throw new NotFoundError("Section not found");
      }
      res.status(200).json(successResponse(section));
    } catch (err) {
      next(err);
    }
  });

  router.post(
    "/:profileId/get-all-section-options",
    requirePermission(Permissions.SECTION_READ),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const section = await sectionService.getAllSectionOptions(req.params.profileId);
        if (!section) {
          throw new NotFoundError("Section not found");
        }
        res.status(200).json(successResponse(section.data, section.metadata));
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    "/:flowSettingId/get-all-by-flow-setting-id",
    requirePermission(Permissions.SECTION_READ),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const sections = await sectionService.getAllByFlowSettingId(req.params.flowSettingId);
        res.status(200).json(successResponse(sections.data, sections.metadata));
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    "/:flowSettingId/get-sections-with-room-settings",
    requirePermission(Permissions.SECTION_READ),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const sections = await sectionService.getSectionsWithRoomSettings(req.params.flowSettingId);
        res.status(200).json(successResponse(sections.data, sections.metadata));
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
};

export default sectionController;
