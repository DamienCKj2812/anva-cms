import { ObjectId } from "mongodb";

export enum SchemaTypeEnum {
  PRIMITIVE = "primitive", // string, number, boolean
  ARRAY = "array",
}

export enum AttributeTypeEnum {
  STRING = "string",
  NUMBER = "number",
  BOOLEAN = "boolean",
}

export enum AttributeFormatEnum {
  DATE_TIME = "date-time",
  DATE = "date",
  TIME = "time",
  URI = "uri",
  MEDIA_URI = "media-uri", // custom format
}


export interface ValidationRules {
  minLength?: number; // For strings
  maxLength?: number; // For strings
  minimum?: number; // For numbers
  maximum?: number; // For numbers
  pattern?: string; // Regex
}

export interface Attribute {
  _id?: ObjectId;
  contentCollectionId: ObjectId;
  key: string; // JSON Schema "property name"
  label: string; // Human-friendly label for UI
  schemaType: SchemaTypeEnum;
  attributeType: AttributeTypeEnum;
  attributeFormat?: AttributeFormatEnum;
  required: boolean;
  defaultValue?: any;
  enumValues?: string[];
  validation?: ValidationRules;
  inheritDefault: boolean;
  position: number;
  createdBy: ObjectId;
  createdAt: Date;
  updatedAt: Date | null;
}

export interface UpdateAttributeData {
  label?: string;
  required?: boolean;
  defaultValue?: any;
  enumValues?: string[];
  validation?: ValidationRules;
  inheritDefault?: boolean;
}

export type CreateAttributeData = {
  label: string;
  contentCollectionId: string; // Accept string, convert to ObjectId later
  key: string;
  schemaType: SchemaTypeEnum;
  attributeType: AttributeTypeEnum;
  attributeFormat?: AttributeFormatEnum;
  required: boolean;
  format?: AttributeFormatEnum;
  defaultValue?: any;
  enumValues?: string[];
  validation?: ValidationRules;
  inheritDefault: boolean;
};

export interface DeleteAttributeResponse {
  status: "success" | "failed";
  data: any;
}
