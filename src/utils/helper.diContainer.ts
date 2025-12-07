import AttributeComponentService from "../module/attribute-component/database/services";
import AttributeService from "../module/attribute/database/services";
import AuthService from "../module/auth/database/services";
import ContentCollectionService from "../module/content-collection/database/services";
import ContentTranslationService from "../module/content-translation/database/services";
import ContentService from "../module/content/database/services";
import FolderService from "../module/folder/database/services";
import MediaAssetService from "../module/media-asset/database/services";
import TenantLocaleService from "../module/tenant-locale/database/services";
import TenantService from "../module/tenant/database/services";
import UserService from "../module/user/database/services";
import { AppContext } from "./helper.context";

export type ServiceMap = {
  UserService: UserService;
  AuthService: AuthService;
  TenantService: TenantService;
  TenantLocaleService: TenantLocaleService;
  ContentCollectionService: ContentCollectionService;
  AttributeService: AttributeService;
  AttributeComponentService: AttributeComponentService;
  ContentService: ContentService;
  ContentTranslationService: ContentTranslationService;
  MediaAssetService: MediaAssetService;
  FolderService: FolderService;
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
  const tenantLocaleService = new TenantLocaleService(context);
  const contentCollectionService = new ContentCollectionService(context);
  const attributeService = new AttributeService(context);
  const attributeComponentService = new AttributeComponentService(context);
  const contentService = new ContentService(context);
  const contentTranslation = new ContentTranslationService(context);
  const mediaAssetService = new MediaAssetService(context);
  const folderService = new FolderService(context);

  // Register all services
  container.register("AuthService", authService);
  container.register("UserService", userService);
  container.register("TenantService", tenantService); // register this first before the user service
  container.register("TenantLocaleService", tenantLocaleService);
  container.register("ContentCollectionService", contentCollectionService);
  container.register("AttributeService", attributeService);
  container.register("AttributeComponentService", attributeComponentService);
  container.register("ContentService", contentService);
  container.register("ContentTranslationService", contentTranslation);
  container.register("MediaAssetService", mediaAssetService);
  container.register("FolderService", folderService);

  // Call init for each service
  authService.init();
  userService.init();
  tenantService.init();
  tenantLocaleService.init();
  contentCollectionService.init();
  attributeService.init();
  attributeComponentService.init();
  contentService.init();
  contentTranslation.init();
  mediaAssetService.init();
  folderService.init();
}
