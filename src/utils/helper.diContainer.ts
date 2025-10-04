import AttributeService from "../module/attribute/database/services";
import AuthService from "../module/auth/database/services";
import ContentCollectionService from "../module/content-collection/database/services";
import ContentService from "../module/content/database/services";
import MediaAssetService from "../module/media-asset/database/services";
import TenantService from "../module/tenant/database/services";
import UserService from "../module/user/database/services";
import { AppContext } from "./helper.context";
import FileUploaderGCSService from "./helper.fileUploadGCSService";

export type ServiceMap = {
  UserService: UserService;
  AuthService: AuthService;
  TenantService: TenantService;
  ContentCollectionService: ContentCollectionService;
  AttributeService: AttributeService;
  ContentService: ContentService;
  FileUploaderGCSService: FileUploaderGCSService;
  MediaAssetService: MediaAssetService;
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
  const tenantService = new TenantService(context);
  const contentCollectionService = new ContentCollectionService(context);
  const attributeService = new AttributeService(context);
  const contentService = new ContentService(context);
  const fileUploaderGCSService = new FileUploaderGCSService(context);
  const mediaAssetService = new MediaAssetService(context);

  // Register all services
  container.register("AuthService", authService);
  container.register("UserService", userService);
  container.register("TenantService", tenantService);
  container.register("ContentCollectionService", contentCollectionService);
  container.register("AttributeService", attributeService);
  container.register("ContentService", contentService);
  container.register("FileUploaderGCSService", fileUploaderGCSService);
  container.register("MediaAssetService", mediaAssetService);

  // Call init for each service
  authService.init();
  userService.init();
  tenantService.init();
  contentCollectionService.init();
  attributeService.init();
  contentService.init();
  fileUploaderGCSService.init();
  mediaAssetService.init();
}
