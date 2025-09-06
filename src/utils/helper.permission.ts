import { Request, Response, NextFunction } from "express";
import { ForbiddenError, UnauthorizedError } from "../utils/helper.errors";
import { UserRoleEnum } from "../module/user/database/models";
import { AppContext } from "./helper.context";

export enum Permissions {
  //! User
  USER_CREATE = "user:create",
  USER_READ = "user:read",
  USER_READ_ALL = "user:readAll",
  USER_UPDATE = "user:update",
  USER_DELETE = "user:delete",
  //! Organization
  ORGANIZATION_CREATE = "organization:create",
  ORGANIZATION_READ = "organization:read",
  ORGANIZATION_READ_ALL = "organization:readAll",
  ORGANIZATION_UPDATE = "organization:update",
  // ORGANIZATION_DELETE = "organization:delete",
  //! Tenant
  TENANT_CREATE = "tenant:create",
  TENANT_READ = "tenant:read",
  TENANT_READ_ALL = "tenant:readAll",
  TENANT_UPDATE = "tenant:update",
  // TENANT_DELETE = "tenant:delete",
  //! Content Collection
  CONTENT_COLLECTION_CREATE = "contentCollection:create",
  CONTENT_COLLECTION_READ = "contentCollection:read",
  CONTENT_COLLECTION_READ_ALL = "contentCollection:readAll",
  CONTENT_COLLECTION_UPDATE = "contentCollection:update",
  // CONTENT_COLLECTION_DELETE = "contentCollection:delete",
  //! Attribute Collection
  ATTRIBUTE_COLLECTION_CREATE = "attributeCollection:create",
  ATTRIBUTE_COLLECTION_READ = "attributeCollection:read",
  ATTRIBUTE_COLLECTION_READ_ALL = "attributeCollection:readAll",
  ATTRIBUTE_COLLECTION_UPDATE = "attributeCollection:update",
  // ATTRIBUTE_COLLECTION_DELETE = "attributeCollection:delete",
}

export function requirePermission(context: AppContext, permission: Permissions) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;

    if (!user) {
      return next(new UnauthorizedError("Unauthorized"));
    }

    // Skip permission check if user is an admin
    if (user.userRole == UserRoleEnum.admin) {
      return next();
    }

    if (!context.currentUser?.permissions.includes(permission)) {
      return next(new ForbiddenError(`Forbidden: You do not have the ${permission} permission`));
    }

    next();
  };
}
