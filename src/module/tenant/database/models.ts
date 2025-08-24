import { ObjectId } from "mongodb";

export interface Tenant {
  _id?: ObjectId;
  organizationId: ObjectId;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt?: Date | null;
  createdBy: ObjectId;
}

export interface UpdateTenantData {
  name?: string;
  slug?: string;
}

export type CreateTenantData = Omit<Tenant, "_id" | "organizationId" | "createdAt" | "updatedAt">;
