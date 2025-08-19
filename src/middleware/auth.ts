import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import configs from "../configs";
import { JwtPayload } from "../module/auth/database/models";
import { UnauthorizedError } from "../utils/helper.errors";
import { Permissions } from "../utils/helper.permission";

declare global {
  namespace Express {
    interface Request {
      profile?: JwtPayload;
    }
  }
}

export function authenticate(context: any) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = req.cookies?.token || req.header("Authorization")?.replace("Bearer ", "");

      if (!token) {
        return next(new UnauthorizedError("Unauthorized"));
      }

      const decoded = jwt.verify(token, configs.JWT_SECRET);

      const profileService = context.diContainer!.get("ProfileService");
      const profile = await profileService.getById(decoded.id);

      if (!profile) {
        return next(new UnauthorizedError("Unauthorized"));
      }

      // Temp hardcode the permissions
      const currentProfile = {
        id: decoded.id,
        name: profile.name,
        userRole: profile.userRole,
        permissions: [
          Permissions.PROFILE_READ,
          Permissions.PROFILE_UPDATE,
          Permissions.CHATBOT_SETTING_READ,
          Permissions.FLOW_SETTING_READ,
          Permissions.CHATBOT_SETTING_READ,
          Permissions.SECTION_CONTENT_READ,
          Permissions.SECTION_ROOM_SETTING_READ,
          Permissions.SECTION_ROOM_CREATE,
          Permissions.SECTION_ROOM_READ,
          Permissions.SECTION_CONTENT_READ,
          Permissions.SECTION_CONTENT_UPDATE,
        ],
      };

      req.profile = currentProfile;

      if (context) {
        context.currentProfile = currentProfile;
      }

      next();
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        return next(new UnauthorizedError("Token expired"));
      }
      if (err instanceof jwt.JsonWebTokenError) {
        return next(new UnauthorizedError("Invalid token"));
      }
      next(err);
    }
  };
}
