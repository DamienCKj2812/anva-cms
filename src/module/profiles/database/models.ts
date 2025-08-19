import { ObjectId } from "mongodb";
import { Permissions } from "../../../utils/helper.permission";

export enum UserRoleEnum {
  backoffice = "backOffice",
  client = "client",
}

export interface Profile {
  _id?: ObjectId;
  name: string;
  userRole: UserRoleEnum;
  createdAt?: Date;
  updatedAt?: Date | null;
  totalCredits: number;
  password?: string; // Optional for update operations
}

export interface ContextProfile {
  id: string;
  name: string;
  userRole: UserRoleEnum;
}

export interface UpdateProfileData {
  name?: string;
  userRole?: UserRoleEnum;
  password?: string;
  totalCredits?: number;
}

export type CreateProfileData = Omit<Profile, "_id" | "createdAt" | "updatedAt">;
