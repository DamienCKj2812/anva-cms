import { AppContext } from "../../../../utils/helper.context";
import { ChatbotSettings } from "../../../chatbot-settings/database/models";
import { SectionRoomSetting } from "../../../section-room-setting/database/model";
import { SectionRoom } from "../../../section-room/database/model";
import { LLMProvider, LLMResponse, LLMStrategy } from "../models";
import DeepSeekStrategy from "./strategy.deepseek";
import GeminiStrategy from "./strategy.gemini";
import OpenAIStrategy from "./strategy.openai";

const strategyCache: Map<string, LLMStrategy> = new Map(); // Share the instance if the provider and token

class LLMService {
  private context: AppContext;

  constructor(context: AppContext) {
    this.context = context;
  }

  getOrCreateStrategy(provider: LLMProvider, token: string): LLMStrategy {
    const key = `${provider}:${token}`;
    if (strategyCache.has(key)) {
      return strategyCache.get(key)!;
    }

    let strategy: LLMStrategy;
    switch (provider) {
      case "openai":
        strategy = new OpenAIStrategy(this.context);
        break;
      case "deepseek":
        strategy = new DeepSeekStrategy(this.context);
        break;
      case "gemini":
        strategy = new GeminiStrategy(this.context);
        break;
      default:
        throw new Error("Unsupported provider");
    }
    // !Important
    strategy.init();

    strategyCache.set(key, strategy);
    return strategy;
  }

  async generateStreamResponse(
    provider: LLMProvider,
    chatbotSetting: ChatbotSettings,
    sectionRoom: SectionRoom,
    sectionRoomSetting: SectionRoomSetting,
    options?: Record<string, any>
  ): Promise<LLMResponse> {
    const strategy = this.getOrCreateStrategy(provider, chatbotSetting.token);
    return strategy.generateStreamResponse(chatbotSetting, sectionRoom, sectionRoomSetting, options);
  }

  async onEvent(provider: LLMProvider, token: string, listener: (event: any) => void): Promise<void> {
    const strategy = this.getOrCreateStrategy(provider, token);
    strategy.onEvent?.(listener);
  }

  async onFailed(provider: LLMProvider, token: string, listener: (error: any) => void): Promise<void> {
    const strategy = this.getOrCreateStrategy(provider, token);
    strategy.onFailed?.(listener);
  }

  async logAllListeners(provider: LLMProvider, token: string): Promise<void> {
    const strategy = this.getOrCreateStrategy(provider, token);
    strategy.logAllListeners();
  }
}

export default LLMService;
