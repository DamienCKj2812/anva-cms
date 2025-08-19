import { Router, Request, Response, NextFunction } from "express";
import { authenticate } from "../../middleware/auth";
import { successResponse } from "../../utils/helper.response";
import { NotFoundError } from "../../utils/helper.errors";
import { AppContext } from "../../utils/helper.context";
import { Permissions, requirePermission } from "../../utils/helper.permission";

const chatbotSettingsController = (context: AppContext) => {
  const router = Router();
  const chatbotSettingsService = context.diContainer!.get("ChatbotSettingService");

  router.use(authenticate(context));

  router.post("/create", requirePermission(Permissions.CHATBOT_SETTING_CREATE), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const newSettings = await chatbotSettingsService.create(req.body);
      res.status(201).json(successResponse(newSettings));
    } catch (err) {
      next(err);
    }
  });

  router.post("/:chatbotSettingId/update", requirePermission(Permissions.CHATBOT_SETTING_UPDATE), async (req: Request, res, next: NextFunction) => {
    try {
      const updatedSettings = await chatbotSettingsService.update(req.params.chatbotSettingId, req.body);
      res.status(200).json(successResponse(updatedSettings));
    } catch (err) {
      next(err);
    }
  });

  router.post("/:chatbotSettingId/get", requirePermission(Permissions.CHATBOT_SETTING_READ), async (req: Request, res, next: NextFunction) => {
    try {
      const setting = await chatbotSettingsService.getById(req.params.chatbotSettingId);
      if (!setting) {
        throw new NotFoundError("Chatbot setting not found");
      }
      res.status(201).json(successResponse(setting));
    } catch (err) {
      next(err);
    }
  });

  router.post(
    "/:profileId/get-all-chatbot-setting-by-profile",
    requirePermission(Permissions.SECTION_READ),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const chatbotSetting = await chatbotSettingsService.getChatbotSettingsByProfileId(req.params.profileId);
        res.status(200).json(successResponse(chatbotSetting.data, chatbotSetting.metadata));
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    "/:profileId/get-all-chatbot-setting-options",
    requirePermission(Permissions.SECTION_READ),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const chatbotSetting = await chatbotSettingsService.getChatbotSettingOptions(req.params.profileId);
        res.status(200).json(successResponse(chatbotSetting.data, chatbotSetting.metadata));
      } catch (err) {
        next(err);
      }
    }
  );

  router.post("/:chatbotSettingId/delete", requirePermission(Permissions.CHATBOT_SETTING_DELETE), async (req: Request, res, next: NextFunction) => {
    try {
      const setting = await chatbotSettingsService.delete(req.params.chatbotSettingId);
      res.json(successResponse(setting));
    } catch (err) {
      next(err);
    }
  });

  router.post("/get-batch", requirePermission(Permissions.CHATBOT_SETTING_READ), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ids } = req.body;
      const chatbotSettings = await chatbotSettingsService.getBatch(ids);
      res.status(200).json(successResponse(chatbotSettings));
    } catch (err) {
      next(err);
    }
  });

  return router;
};

export default chatbotSettingsController;
