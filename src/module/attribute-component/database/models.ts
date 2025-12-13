import { ObjectId } from "mongodb";

export interface AttributeComponent {
  _id: ObjectId;
  tenantId: ObjectId;
  key: string; // Just for uniquely identify, not used in the schema, use the attribute.key as source of trust
  label: string;
  category: string;
  schema: any;
  attributes: ObjectId[];
  createdBy: ObjectId;
  createdAt: Date;
  updatedAt: Date | null;
}

export interface CreateAttributeComponentDto {
  key: string;
  label: string;
  category: string;
}

export interface UpdateAttributeComponentDto {
  label?: string;
  category?: string;
}

export interface AttributeComponentGroup {
  category: string;
  attributeComponents: AttributeComponent[];
}
