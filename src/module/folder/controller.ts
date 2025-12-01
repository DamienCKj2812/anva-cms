import { Router, Request, Response, NextFunction } from "express";
import { successResponse } from "../../utils/helper.response";
import { authenticate } from "../../middleware/auth";
import { AppContext } from "../../utils/helper.context";
import { getCurrentUserId } from "../../utils/helper.auth";
import { ObjectId } from "mongodb";

const folderController = (context: AppContext) => {
  const router = Router();
  const folderService = context.diContainer!.get("FolderService");

  router.use(authenticate(context));

  router.post("/get", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getCurrentUserId(context);
      const { tenantId, parentId } = req.query as { tenantId?: string, parentId?: string };
      const filter: any = {
        createdBy: new ObjectId(userId),
      };
      if (tenantId) {
        filter.tenantId = new ObjectId(tenantId);
      }
      filter.parentId = parentId
        ? new ObjectId(parentId)
        : null;
      const contents = await folderService.findMany(filter);
      res.status(200).json(successResponse(contents));
    } catch (err) {
      next(err);
    }
  });

  router.post("/create", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const contents = await folderService.create(req.body);
      res.status(200).json(successResponse(contents));
    } catch (err) {
      next(err);
    }
  });


  router.post("/:folderId/get-path", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const contents = await folderService.getFolderPath(req.params.folderId);
      res.status(200).json(successResponse(contents));
    } catch (err) {
      next(err);
    }
  });

  return router;
};

export default folderController;
