import { ObjectId } from "mongodb";
import { Permissions } from "../../../utils/helper.permission";

export enum UserRoleEnum {
  admin = "admin",
  user = "user",
}

export interface User {
  _id?: ObjectId;
  organizationId: ObjectId;
  name: string;
  password: string; // Optional for update operations
  userRole: UserRoleEnum;
  permissions: Permissions[];
  createdAt?: Date;
  updatedAt?: Date | null;
}

export interface ContextUser {
  id: string;
  name: string;
  organizationId: string;
  userRole: UserRoleEnum;
  permissions: Permissions[];
}

export interface UpdateUserData {
  name?: string;
  password?: string;
  userRole?: string;
  permissions?: string[];
}

export type CreateUserData = Omit<User, "_id" | "organizationId" | "createdAt" | "updatedAt">;
