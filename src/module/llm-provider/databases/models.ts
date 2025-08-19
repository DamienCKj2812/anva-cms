import { ChatbotSettings } from "../../chatbot-settings/database/models";
import { ReferenceRoleEnum } from "../../section-content/database/model";
import { SectionRoomSetting } from "../../section-room-setting/database/model";
import { SectionRoom } from "../../section-room/database/model";

export enum LLMProvider {
  OpenAI = "openai",
  Gemini = "gemini",
  DeepSeek = "deepseek",
  // Anthropic = "anthropic",
}

export enum OpenAIModel {
  GPT35 = "gpt-3.5-turbo",
  GPT4 = "gpt-4",
  GPT4Turbo = "gpt-4-turbo",
  GPT4o = "gpt-4o",
}

export enum GeminiModel {
  Pro = "gemini-pro",
  Flash = "gemini-1.5-flash",
  Pro15 = "gemini-1.5-pro",
}

export enum DeepSeekModel {
  Chat = "deepseek-chat",
  Coder = "deepseek-coder",
}

export const ChatbotModelMap: Record<LLMProvider, string[]> = {
  [LLMProvider.OpenAI]: Object.values(OpenAIModel),
  [LLMProvider.Gemini]: Object.values(GeminiModel),
  [LLMProvider.DeepSeek]: Object.values(DeepSeekModel),
};

export interface LLMResponse {
  responseId: string; // LLM-generated message/request id
  model?: string; // The model used (e.g. "gpt-4o")
  output: string; // Raw reply from the LLM
  usage: {
    // Token usage and cost
    inputToken: number;
    outputToken: number;
  };
  timestamp: Date | null; // When the response was created
  streamed?: boolean; // True if streaming
  errMsg: string | null;
  previousResponseId: string | null; 
  raw?: any; // Complete LLM payload for debugging
}

export interface LLMStrategy {
  init(): void;
  generateStreamResponse(
    chatbotSetting: ChatbotSettings,
    sectionRoom: SectionRoom,
    sectionRoomSetting: SectionRoomSetting,
    options?: Record<string, any>
  ): Promise<LLMResponse>;
  onEvent(listener: (e: any) => void): void;
  onFailed(listener: (e: any) => void): void;
  logAllListeners(): Promise<void>;
}
