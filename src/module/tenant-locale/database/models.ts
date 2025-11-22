import { ObjectId } from "mongodb";

export interface TenantLocale {
  _id: ObjectId;
  tenantId: ObjectId;
  locale: string;
  displayName: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt?: Date | null;
  createdBy: ObjectId;
}

export interface CreateTenantLocaleData {
  tenantId: string;
  locale: string;
  displayName: string;
}

export interface UpdateTenantLocaleData {
  displayName?: string;
}
