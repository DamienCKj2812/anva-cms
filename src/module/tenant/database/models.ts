import { ObjectId } from "mongodb";

export interface Tenant {
  _id?: ObjectId;
  name: string;
  createdAt: Date;
  updatedAt?: Date | null;
  createdBy: ObjectId;
}

export interface UpdateTenantData {
  name?: string;
}

export type CreateTenantData = Omit<Tenant, "_id" | "createdAt" | "updatedAt">;
