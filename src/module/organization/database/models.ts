import { ObjectId } from "mongodb";

export interface Organization {
  _id?: ObjectId;
  name: string;
  createdAt: Date;
}

export type CreateOrganizationData = Omit<Organization, "_id" | "createdAt">;
