import OpenAI from "openai";
import { ChatbotModelMap, LLMProvider, LLMResponse, LLMStrategy } from "../models";
import SectionContentService from "../../../section-content/database/services";
import { AppContext } from "../../../../utils/helper.context";
import { ResponseInputItem } from "openai/resources/responses/responses";
import { EventEmitter } from "events";
import { BaseService } from "../../../core/base-service";
import { ReferenceRoleEnum, SectionContent } from "../../../section-content/database/model";
import SectionContentSettingService from "../../../section-room-setting/database/service";
import { ChatbotSettings } from "../../../chatbot-settings/database/models";
import { SectionRoomSetting } from "../../../section-room-setting/database/model";
import { NotFoundError } from "../../../../utils/helper.errors";
import { SectionRoom } from "../../../section-room/database/model";
import SectionRoomSettingService from "../../../section-room-setting/database/service";
import SectionRoomService from "../../../section-room/database/service";
import { UserRoleEnum } from "../../../profiles/database/models";

class OpenAIStrategy extends BaseService implements LLMStrategy {
  private sectionRoomSettingService: SectionRoomSettingService;
  private sectionRoomService: SectionRoomService;
  private sectionContentService: SectionContentService;
  private events = new EventEmitter();

  constructor(context: AppContext) {
    super(context);
  }

  async init() {
    this.sectionRoomSettingService = this.getService("SectionRoomSettingService");
    this.sectionRoomService = this.getService("SectionRoomService");
    this.sectionContentService = this.getService("SectionContentService");
  }

  // Use to fetch all the event
  public onEvent(listener: (e: any) => void) {
    this.events.on("event", listener);
  }

  public onFailed(listener: (e: any) => void) {
    this.events.on("failed", listener);
  }

  async logAllListeners() {
    const eventNames = this.events.eventNames();

    console.log("\n\n==== OpenAI Bus Listeners ====");
    for (const event of eventNames) {
      const count = this.events.listenerCount(event);
      console.log(`Event "${String(event)}" has ${count} listener(s)`);
      const listeners = this.events.listeners(event);
      listeners.forEach((listener, index) => {
        console.log(`  Listener ${index + 1}:`, listener.toString().slice(0, 100) + "...");
      });
    }
    console.log("====================================");
  }

  async generateStreamResponse(
    chatbotSetting: ChatbotSettings,
    sectionRoom: SectionRoom,
    sectionRoomSetting: SectionRoomSetting,
    options?: Record<string, any>
  ): Promise<LLMResponse> {
    await this.validateInput(chatbotSetting.token, chatbotSetting.model, sectionRoom.draftInput, options);
    const client = new OpenAI({ apiKey: chatbotSetting.token });
    const input: ResponseInputItem[] = [];
    const userId = this.context.currentProfile?.id;

    if (!userId) {
      throw new NotFoundError("Current user not found");
    }

    for (const r of sectionRoomSetting.references) {
      if (!r.sectionRoomSettingId) continue;

      const sectionRoom = await this.sectionRoomService.findOne({
        sectionRoomSettingId: r.sectionRoomSettingId,
      });
      const sectionContents = await this.sectionContentService.getAll({
        filter: { sectionRoomId: sectionRoom?._id, markedAsResult: true },
        sort: { position: -1 },
      });

      input.push(
        ...sectionContents.data.map((c) => ({
          role: c.role,
          content: c.output || "",
        }))
      );
    }

    // Add current prompt as user message
    input.push({ role: "user", content: sectionRoom.draftInput });

    console.log("instruction: ", sectionRoomSetting.systemPrompt);
    console.log("input: ", input);

    const stream = await client.responses.create({
      model: chatbotSetting.model,
      input,
      instructions: sectionRoomSetting.systemPrompt,
      stream: true,
      ...options,
    });

    let llmResponse: LLMResponse = {
      responseId: "",
      model: chatbotSetting.model,
      output: "",
      usage: {
        inputToken: 0,
        outputToken: 0,
      },
      timestamp: null,
      streamed: true,
      errMsg: "",
      previousResponseId: null,
      raw: null,
    };

    let output: string = "";
    for await (const event of stream) {
      if (event.type === "response.failed" || event.type === "error") {
        this.events.emit("failed", event);
        break;
      }
      if (event.type === "response.completed") {
        llmResponse = {
          responseId: event.response.id,
          output,
          usage: {
            inputToken: event.response.usage?.input_tokens ?? 0,
            outputToken: event.response.usage?.output_tokens ?? 0,
          },
          timestamp: new Date(),
          streamed: true,
          errMsg: event.response.error?.message || null,
          previousResponseId: event.response.previous_response_id || null,
          raw: event,
        };
      }
      if (event.type === "response.output_text.done") {
        output = event.text;
      }
      this.events.emit("event", event);
    }

    this.events.emit("event", { type: "done" });
    this.events.removeAllListeners("event");
    this.events.removeAllListeners("failed");

    return llmResponse;
  }

  async validateInput(token: string, model: string, prompt: string, options?: Record<string, any>): Promise<void> {
    if (!token || typeof token !== "string") {
      throw new Error("Token must be a non-empty string");
    }
    if (!model || typeof model !== "string") {
      throw new Error("Model must be a non-empty string");
    }
    if (!prompt || typeof prompt !== "string") {
      throw new Error("Prompt must be a non-empty string");
    }
    if (options && typeof options !== "object") {
      throw new Error("Options must be an object");
    }
    if (ChatbotModelMap[LLMProvider.OpenAI].indexOf(model) === -1) {
      throw new Error(`Model must be one of ${ChatbotModelMap[LLMProvider.OpenAI].join(", ")}`);
    }
  }
}

export default OpenAIStrategy;
