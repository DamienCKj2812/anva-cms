import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import configs from "../configs";
import { JwtPayload } from "../module/auth/database/models";
import { UnauthorizedError } from "../utils/helper.errors";
import { AppContext } from "../utils/helper.context";
import { ContextUser } from "../module/user/database/models";

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function authenticate(context: AppContext) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = req.cookies?.token || req.header("Authorization")?.replace("Bearer ", "");

      if (!token) {
        return next(new UnauthorizedError("Unauthorized"));
      }

      const decoded = jwt.verify(token, configs.JWT_SECRET);

      const userService = context.diContainer!.get("UserService");
      const user = await userService.getById(decoded.id);

      if (!user) {
        return next(new UnauthorizedError("Unauthorized"));
      }

      // Temp hardcode the permissions
      const currentUser: ContextUser = {
        id: decoded.id,
        organizationId: user.organizationId.toString(),
        name: user.name,
      };

      req.user = currentUser;

      if (context) {
        context.currentUser = currentUser;
        context.orgBucketName = user.orgBucketName;
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
