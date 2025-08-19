import { Router } from "express";
import profileController from "../module/profiles/controller";
import authController from "../module/auth/controller";
import chatbotSettingsController from "../module/chatbot-settings/controller";
import flowSettingController from "../module/flow-settings/controller";
import sectionController from "../module/section/controller";
import sectionContentController from "../module/section-content/controller";
import sectionRoomController from "../module/section-room/controller";
import sectionRoomSettingController from "../module/section-room-setting/controller";

const createRouter = (context: any) => {
  const router = Router();

  router.use("/auth", authController(context));
  router.use("/profile", profileController(context));
  router.use("/chatbot-settings", chatbotSettingsController(context));
  router.use("/flow-settings", flowSettingController(context));
  router.use("/sections", sectionController(context));
  router.use("/section-room-settings", sectionRoomSettingController(context));
  router.use("/section-room", sectionRoomController(context));
  router.use("/section-contents", sectionContentController(context));

  return router;
};

export default createRouter;
