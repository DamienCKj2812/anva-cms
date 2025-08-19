import { Request, Response, NextFunction, Router } from "express";
import { authenticate } from "../../middleware/auth";
import { successResponse } from "../../utils/helper.response";
import { NotFoundError } from "../../utils/helper.errors";
import { AppContext } from "../../utils/helper.context";
import { Permissions, requirePermission } from "../../utils/helper.permission";

const flowSettingController = (context: AppContext) => {
  const router = Router();
  const flowSettingService = context.diContainer!.get("FlowSettingService");

  router.use(authenticate(context));
  router.post("/create", requirePermission(Permissions.FLOW_SETTING_CREATE), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const newFlowSetting = await flowSettingService.create(req.body);
      res.status(201).json(successResponse(newFlowSetting));
    } catch (err) {
      next(err);
    }
  });

  router.post(
    "/:flowSettingId/update",
    requirePermission(Permissions.FLOW_SETTING_UPDATE),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const updatedFlowSetting = await flowSettingService.update(req.params.flowSettingId, req.body);
        res.status(200).json(successResponse(updatedFlowSetting));
      } catch (err) {
        next(err);
      }
    }
  );

  router.post("/:flowSettingId/get", requirePermission(Permissions.FLOW_SETTING_READ), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updatedFlowSetting = await flowSettingService.getById(req.params.flowSettingId);
      if (!updatedFlowSetting) {
        throw new NotFoundError("Flow setting not found");
      }
      res.status(201).json(successResponse(updatedFlowSetting));
    } catch (err) {
      next(err);
    }
  });

  router.post("/get-batch", requirePermission(Permissions.FLOW_SETTING_READ), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ids } = req.body;
      const flowSettings = await flowSettingService.getBatch(ids);
      res.status(200).json(successResponse(flowSettings));
    } catch (err) {
      next(err);
    }
  });

  router.post(
    "/:profileId/get-all-flow-settings-by-profile-id",
    requirePermission(Permissions.FLOW_SETTING_READ),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const flowSettings = await flowSettingService.getAllByProfileId(req.params.profileId);
        res.status(200).json(successResponse(flowSettings.data, flowSettings.metadata));
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    "/:profileId/get-all-flow-setting-options",
    requirePermission(Permissions.SECTION_READ),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const flowSettings = await flowSettingService.getAllFlowSettingOptions(req.params.profileId);
        res.status(200).json(successResponse(flowSettings.data, flowSettings.metadata));
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    "/:profileId/get-all-flow-settings-with-section-name",
    requirePermission(Permissions.SECTION_READ),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const flowSettings = await flowSettingService.getAllFlowSettingWithSectionName(req.params.profileId);
        res.status(200).json(successResponse(flowSettings.data, flowSettings.metadata));
      } catch (err) {
        next(err);
      }
    }
  );
  return router;
};

export default flowSettingController;
