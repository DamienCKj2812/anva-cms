import { Request, Response, NextFunction } from "express";
import { ForbiddenError, UnauthorizedError } from "../utils/helper.errors";
import { UserRoleEnum } from "../module/profiles/database/models";

export enum Permissions {
  PROFILE_CREATE = "profile:create",
  PROFILE_READ = "profile:read",
  PROFILE_READ_ALL = "profile:readAll",
  PROFILE_UPDATE = "profile:update",
  PROFILE_DELETE = "profile:delete",
  CHATBOT_SETTING_READ = "chatbotSetting:read",
  CHATBOT_SETTING_CREATE = "chatbotSetting:create",
  CHATBOT_SETTING_UPDATE = "chatbotSetting:update",
  CHATBOT_SETTING_DELETE = "chatbotSetting:delete",
  FLOW_SETTING_READ = "flowSetting:read",
  FLOW_SETTING_CREATE = "flowSetting:create",
  FLOW_SETTING_UPDATE = "flowSetting:update",
  FLOW_SETTING_DELETE = "flowSetting:delete",
  SECTION_READ = "section:read",
  SECTION_CREATE = "section:create",
  SECTION_UPDATE = "section:update",
  SECTION_DELETE = "section:delete",
  SECTION_ROOM_SETTING_READ = "sectionContentSetting:read",
  SECTION_ROOM_SETTING_CREATE = "sectionContentSetting:create",
  SECTION_ROOM_SETTING_UPDATE = "sectionContentSetting:update",
  SECTION_ROOM_SETTING_DELETE = "sectionContentSetting:delete",
  SECTION_ROOM_READ = "sectionRoom:read",
  SECTION_ROOM_CREATE = "sectionRoom:create",
  SECTION_ROOM_UPDATE = "sectionRoom:update",
  SECTION_ROOM_DELETE = "sectionRoom:delete",
  SECTION_CONTENT_READ = "sectionContent:read",
  SECTION_CONTENT_CREATE = "sectionContent:create",
  SECTION_CONTENT_UPDATE = "sectionContent:update",
  SECTION_CONTENT_DELETE = "sectionContent:delete",
}

export function requirePermission(permission: Permissions) {
  return (req: Request, res: Response, next: NextFunction) => {
    const profile = req.profile;

    if (!profile) {
      return next(new UnauthorizedError("Unauthorized"));
    }
    
    // Skip permission check if user is an admin
    if (profile.userRole == UserRoleEnum.backoffice) {
      return next();
    }

    if (!profile.permissions.includes(permission)) {
      return next(new ForbiddenError(`Forbidden: You do not have the ${permission} permission`));
    }

    next();
  };
}
