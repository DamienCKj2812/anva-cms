import AuthService from "../module/auth/database/services";
import ContentCollectionService from "../module/content-collection/database/services";
import OrganizationService from "../module/organization/database/services";
import TenantService from "../module/tenant/database/services";
import UserService from "../module/user/database/services";
import { AppContext } from "./helper.context";

export type ServiceMap = {
  UserService: UserService;
  AuthService: AuthService;
  OrganizationService: OrganizationService;
  TenantService: TenantService;
  ContentCollectionService: ContentCollectionService;
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

export async function createDIContainer(context: AppContext) {
  const container = new DIContainer();
  context.diContainer = container;

  // Create services
  const authService = new AuthService(context);
  const userService = new UserService(context);
  const organizationService = new OrganizationService(context);
  const tenantService = new TenantService(context);
  const contentCollectionService = new ContentCollectionService(context);

  // Register all services
  container.register("AuthService", authService);
  container.register("UserService", userService);
  container.register("OrganizationService", organizationService);
  container.register("TenantService", tenantService);
  container.register("ContentCollectionService", contentCollectionService);

  // Call init for each service
  authService.init();
  const organization = await organizationService.init();
  userService.init(organization);
  tenantService.init();
  contentCollectionService.init();
}
