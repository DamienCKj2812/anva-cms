import ProfileService from "../module/profiles/database/services";
import AuthService from "../module/auth/database/services";
import { AppContext } from "./helper.context";

export type ServiceMap = {
  ProfileService: ProfileService;
  AuthService: AuthService;
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

  // Register all services
  container.register("AuthService", authService);
  container.register("ProfileService", profileService);

  // Call init for each service
  authService.init();
  profileService.init();
}
