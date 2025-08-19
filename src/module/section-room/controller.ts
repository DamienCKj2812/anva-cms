import { Router, Request, Response, NextFunction } from "express";
import { AppContext } from "../../utils/helper.context";
import { Permissions, requirePermission } from "../../utils/helper.permission";
import LLMService from "../llm-provider/databases/services/service.llm";
import { BadRequestError, InternalServerError, NotFoundError, ValidationError } from "../../utils/helper.errors";
import { LLMProvider } from "../llm-provider/databases/models";
import { ReferenceRoleEnum } from "../section-content/database/model";
import { SectionRoomStatusEnum } from "./database/model";
import { successResponse } from "../../utils/helper.response";
import { authenticate } from "../../middleware/auth";

const sectionRoomController = (context: AppContext) => {
  const router = Router();
  const sectionRoomService = context.diContainer!.get("SectionRoomService");
  const sectionContentService = context.diContainer!.get("SectionContentService");
  const clients: Map<string, { connectionId: string; res: Response }> = new Map();
  const llmService = new LLMService(context);

  router.use(authenticate(context));

  router.post("/:sectionRoomId/init-room", requirePermission(Permissions.SECTION_ROOM_CREATE), async (req, res, next) => {
    try {
      const initSectionRoomData = await sectionRoomService.initSectionRoom(req.params.sectionRoomId);
      if (!initSectionRoomData) {
        throw new NotFoundError("Init Section Room data not found");
      }
      return res.status(200).json(successResponse(initSectionRoomData));
    } catch (err) {
      next(err);
    }
  });

  router.post("/:sectionRoomId/get", requirePermission(Permissions.SECTION_ROOM_CREATE), async (req, res, next) => {
    try {
      const sectionRoom = await sectionRoomService.getById(req.params.sectionRoomId);
      if (!sectionRoom) {
        throw new NotFoundError("Section Room not found");
      }
      return res.status(200).json(successResponse(sectionRoom));
    } catch (err) {
      next(err);
    }
  });

  // Endpoint for establish the SSE Connection
  // !Firefox in development environment will send two get request within a refresh causing conflict issue
  router.get("/stream/:sectionRoomId", requirePermission(Permissions.SECTION_CONTENT_READ), async (req, res, next) => {
    try {
      const sectionRoom = await sectionRoomService.getById(req.params.sectionRoomId);
      if (!sectionRoom) throw new NotFoundError("Section Room not found");

      const connectionId = req.query.conn;
      const profileId = context.currentProfile!.id;
      const key = `${profileId}:${req.params.sectionRoomId}`;

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const previous = clients.get(key);
      if (previous && previous.connectionId !== connectionId) {
        previous.res.write(`event: kick\n`);
        previous.res.write(`data: ${JSON.stringify({ message: "You have been disconnected due to a new login." })}\n\n`);
        previous.res.end();
      }
      if (typeof connectionId !== "string") {
        throw new ValidationError("Missing or invalid connId");
      }
      clients.set(key, { connectionId, res });

      const ping = setInterval(() => res.write(": ping\n\n"), 15000);

      req.on("close", () => {
        clearInterval(ping);
        const current = clients.get(key);
        if (current?.connectionId === connectionId) {
          clients.delete(key);
        }
      });
    } catch (err) {
      next(err);
    }
  });

  router.post(
    "/:sectionRoomId/update-input",
    requirePermission(Permissions.SECTION_CONTENT_UPDATE),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const profileId = context.currentProfile!.id;
        const key = `${profileId}:${req.params.sectionRoomId}`;
        const { draftInput } = req.body;
        if (!draftInput) {
          throw new BadRequestError("No input is provided");
        }

        const client = clients.get(key);
        if (!client) {
          throw new NotFoundError("SSE Connection not found, please connect first");
        }

        const { chatbotSetting, sectionRoom, sectionRoomSetting } = await sectionRoomService.updateDraftInput(req.params.sectionRoomId, req.body);

        if (!sectionRoom || !sectionRoom._id) {
          throw new NotFoundError("sectionRoom not found");
        }

        let output = "";

        client.res.write("event: start\n");
        client.res.write("data: {}\n\n");

        llmService.onEvent(chatbotSetting.type as LLMProvider, chatbotSetting.token, (chunk) => {
          output += chunk.content || "";
          client.res.write("event: content\n");
          client.res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        });

        llmService.onFailed(chatbotSetting.type as LLMProvider, chatbotSetting.token, (error) => {
          client.res.write("event: error\n");
          client.res.write(`data: ${JSON.stringify(error)}\n\n`);
        });

        const llmResponse = await llmService.generateStreamResponse(
          chatbotSetting.type as LLMProvider,
          chatbotSetting,
          sectionRoom,
          sectionRoomSetting
        );

        if (llmResponse.errMsg) {
          await sectionRoomService.update(req.params.sectionRoomId, { status: SectionRoomStatusEnum.failed, errMsg: llmResponse.errMsg });
          client.res.write("event: error\n");
          client.res.write(`data: ${JSON.stringify(llmResponse.errMsg)}\n\n`);
          throw new InternalServerError(llmResponse.errMsg);
        }

        const sectionContent = await sectionContentService.create({
          sectionRoomId: sectionRoom._id,
          input: sectionRoom.draftInput,
          output: llmResponse.output,
          inputTokens: llmResponse.usage.inputToken,
          outputTokens: llmResponse.usage.outputToken,
          role: ReferenceRoleEnum.assistant,
          generatedAt: llmResponse.timestamp,
          previousResponseId: llmResponse.previousResponseId || "",
        });

        await sectionRoomService.updateTokenCost(sectionRoom._id.toString(), llmResponse.usage.inputToken, llmResponse.usage.outputToken);

        client.res.write("event: done\n");
        client.res.write(`data: ${JSON.stringify(sectionContent)}\n\n`);

        // // Debugging
        // llmService.logAllListeners(chatbotSetting.type as LLMProvider, chatbotSetting.token);
        return res.status(200).json(successResponse(sectionContent));
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
};

export default sectionRoomController;
