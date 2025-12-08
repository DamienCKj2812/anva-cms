import { ObjectId } from "mongodb";

export interface AttributeComponent {
  _id: ObjectId;
  tenantId: ObjectId;
  key: string;
  label: string;
  category: string;
  schema: any;
  attributes: ObjectId[];
  repeatable: boolean;
  createdBy: ObjectId;
  createdAt: Date;
  updatedAt: Date | null;
}

export interface CreateAttributeComponentDto {
  key: string;
  label: string;
  category: string;
  repeatable: boolean;
}
