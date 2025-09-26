import { Request, Response, NextFunction } from "express";
import { UnauthorizedError } from "../utils/helper.errors";
import { AppContext } from "./helper.context";

export function requirePermission(context: AppContext) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;

    if (!user) {
      return next(new UnauthorizedError("Unauthorized"));
    }

    next();
  };
}
