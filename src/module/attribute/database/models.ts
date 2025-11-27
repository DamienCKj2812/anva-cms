import { ObjectId } from "mongodb";

export enum AttributeTypeEnum {
  STRING = "string",
  NUMBER = "number",
  BOOLEAN = "boolean",
  ARRAY = "array",
  OBJECT = "object",
}

export enum FormatTypeEnum {
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
  type: AttributeTypeEnum; // AJV Basic type
  format?: FormatTypeEnum; // JSON Schema "format"
  required: boolean;
  defaultValue?: any;
  enumValues?: string[];
  validation?: ValidationRules;
  position: number;
  createdBy: ObjectId;
  createdAt: Date;
  updatedAt: Date | null;
}

export interface UpdateAttributeData {
  label?: string;
  format?: FormatTypeEnum;
  required?: boolean;
  defaultValue?: any;
  enumValues?: string[];
  validation?: ValidationRules;
  isTranslatable?: boolean;
}

export type CreateAttributeData = {
  contentCollectionId: string; // Accept string, convert to ObjectId later
  key: string;
  label: string;
  type: AttributeTypeEnum;
  required: boolean;
  format?: FormatTypeEnum;
  defaultValue?: any;
  enumValues?: string[];
  validation?: ValidationRules;
};

export interface DeleteAttributeResponse {
  status: "success" | "failed";
  data: any;
}
