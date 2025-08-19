import ChatbotSettingService from "../module/chatbot-settings/database/services";
import FlowSettingService from "../module/flow-settings/database/services";
import ProfileService from "../module/profiles/database/services";
import SectionService from "../module/section/database/services";
import { AppContext } from "./helper.context";
import AuthService from "../module/auth/database/services";
import SectionRoomSettingService from "../module/section-room-setting/database/service";
import SectionRoomService from "../module/section-room/database/service";
import SectionContentService from "../module/section-content/database/services";

export type ServiceMap = {
  ProfileService: ProfileService;
  AuthService: AuthService;
  FlowSettingService: FlowSettingService;
  ChatbotSettingService: ChatbotSettingService;
  SectionService: SectionService;
  SectionRoomSettingService: SectionRoomSettingService;
  SectionRoomService: SectionRoomService;
  SectionContentService: SectionContentService;
};

export class DIContainer {
  private services = new Map<keyof ServiceMap, any>();

  register<K extends keyof ServiceMap>(key: K, instance: ServiceMap[K]) {
    this.services.set(key, instance);
  }

  get<K extends keyof ServiceMap>(key: K): ServiceMap[K] {
    const service = this.services.get(key);
    if (!service) throw new Error(`Service ${key} not found`);
    return service;
  }
}

export function createDIContainer(context: AppContext) {
  const container = new DIContainer();
  context.diContainer = container;

  // Create services
  const authService = new AuthService(context);
  const profileService = new ProfileService(context);
  const flowSettingService = new FlowSettingService(context);
  const chatbotSettingService = new ChatbotSettingService(context);
  const sectionService = new SectionService(context);
  const sectionRoomSettingService = new SectionRoomSettingService(context);
  const sectionRoomService = new SectionRoomService(context);
  const sectionContentService = new SectionContentService(context);

  // Register all services
  container.register("AuthService", authService);
  container.register("ProfileService", profileService);
  container.register("FlowSettingService", flowSettingService);
  container.register("ChatbotSettingService", chatbotSettingService);
  container.register("SectionService", sectionService);
  container.register("SectionRoomSettingService", sectionRoomSettingService);
  container.register("SectionRoomService", sectionRoomService);
  container.register("SectionContentService", sectionContentService);

  // Call init for each service
  authService.init();
  profileService.init();
  flowSettingService.init();
  chatbotSettingService.init();
  sectionService.init();
  sectionRoomSettingService.init();
  sectionRoomService.init();
  sectionContentService.init();
}
