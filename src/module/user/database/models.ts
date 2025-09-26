import { ObjectId } from "mongodb";

export interface User {
  _id?: ObjectId;
  organizationId: ObjectId;
  name: string;
  password: string; // Optional for update operations
  orgBucketName: string | null;
  createdAt?: Date;
  updatedAt?: Date | null;
}

export interface ContextUser {
  id: string;
  name: string;
  organizationId: string;
}

export interface UpdateUserData {
  name?: string;
  password?: string;
}

export type CreateUserData = Omit<User, "_id" | "organizationId" | "createdAt" | "updatedAt">;
