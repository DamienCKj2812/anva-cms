import { NextFunction, Request, Response, Router } from "express";
import { successResponse } from "../../utils/helper.response";
import configs from "../../configs";
import { authenticate } from "../../middleware/auth";
import { NotFoundError, UnauthorizedError } from "../../utils/helper.errors";
import { AppContext } from "../../utils/helper.context";

const authController = (context: AppContext) => {
  const router = Router();
  const authService = context.diContainer!.get("AuthService");
  const userService = context.diContainer!.get("UserService");

  router.post("/login", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, password } = req.body;
      const { token, user } = await authService.login(name, password);

      // Set token as HttpOnly cookie
      res.cookie("token", token, {
        httpOnly: true,
        secure: configs.ENVIRONMENT === "production",
        sameSite: configs.ENVIRONMENT === "production" ? "none" : "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: "/",
      });

      res.cookie("userRole", user.userRole, {
        httpOnly: true, // Must be accessible from client and middleware
        secure: configs.ENVIRONMENT === "production",
        sameSite: configs.ENVIRONMENT === "production" ? "none" : "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: "/",
      });

      res.json(successResponse({ token, user }));
    } catch (err) {
      next(err);
    }
  });

  router.post("/me", authenticate(context), async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user?.id) {
        throw new UnauthorizedError("Unauthorized");
      }

      const user = await userService.getById(req.user.id);

      if (!user) {
        throw new NotFoundError("User not found");
      }

      res.json(successResponse(user));
    } catch (err) {
      next(err);
    }
  });

  router.post("/logout", authenticate(context), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = req.cookies?.token || req.headers.authorization?.split(" ")[1];

      // Clear client-side tokens
      res.clearCookie("token", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
      });

      res.json(successResponse());
    } catch (err) {
      next(err);
    }
  });

  return router;
};

export default authController;
