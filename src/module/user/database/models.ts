import { ObjectId } from "mongodb";

export interface User {
  _id: ObjectId;
  username: string;
  password: string;
  orgBucketName: string | null;
  createdAt?: Date;
  updatedAt?: Date | null;
}

export interface ContextUser {
  id: string;
  username: string;
}

export interface UpdateUserData {
  username?: string;
  password?: string;
}

export type CreateUserData = Omit<User, "_id" | "createdAt" | "updatedAt">;
