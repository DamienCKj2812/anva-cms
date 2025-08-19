import EventEmitter from "events";
import { LLMResponse, LLMStrategy } from "../models";
import { AppContext } from "../../../../utils/helper.context";
import { BaseService } from "../../../core/base-service";
import { ChatbotSettings } from "../../../chatbot-settings/database/models";
import { SectionRoom } from "../../../section-room/database/model";
import { SectionRoomSetting } from "../../../section-room-setting/database/model";

class GeminiStrategy extends BaseService implements LLMStrategy {
  private events = new EventEmitter();

  constructor(context: AppContext) {
    super(context);
  }

  async init() {}

  // Use to fetch all the event
  public onEvent(listener: (e: any) => void) {
    this.events.on("event", listener);
  }

  public onFailed(listener: (e: any) => void) {
    this.events.on("failed", listener);
  }

  async logAllListeners() {
    const eventNames = this.events.eventNames();

    console.log("\n\n==== Gemini Bus Listeners ====");
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
    return new Promise((resolve, reject) => {
      // Simulate API delay and response
      setTimeout(() => {
        const response: LLMResponse = {
          responseId: "gemini-response-id",
          model: chatbotSetting.model,
          output: `Gemini LLM Response to prompt: ${prompt}`,
          usage: {
            inputToken: 10,
            outputToken: 20,
          },
          timestamp: new Date(),
          streamed: false,
          errMsg: null,
          previousResponseId: null
        };
        resolve(response);
      }, 1000); // Simulate 1 second delay
    });
  }
}

export default GeminiStrategy;
