import { ObjectId } from "mongodb";

export enum AttributeKindEnum {
  PRIMITIVE = "primitive",
  COMPONENT = "component",
  DYNAMIC_ZONE = "dynamic-zone",
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
  _id: ObjectId;
  contentCollectionId?: ObjectId;
  key: string;
  label: string;
  attributeKind: AttributeKindEnum;
  // single component reference (for COMPONENT)
  componentRefId?: ObjectId;
  // multiple component references (for DYNAMIC_ZONE)
  componentRefIds?: ObjectId[];

  attributeType?: AttributeTypeEnum;
  attributeFormat?: AttributeFormatEnum;
  required: boolean;
  defaultValue?: any;
  enumValues?: string[];
  validation?: ValidationRules;
  localizable: boolean;
  position: number;
  createdBy: ObjectId;
  createdAt: Date;
  updatedAt: Date | null;
}

interface CreateAttributeBaseDTO {
  key: string;
  label: string;
  required: boolean;
}

export interface CreatePrimitiveAttributeDTO extends CreateAttributeBaseDTO {
  attributeType: AttributeTypeEnum;
  localizable: boolean;
  attributeFormat?: AttributeFormatEnum;
  defaultValue?: any;
  enumValues?: string[];
  validation?: ValidationRules;
}

// used when the user add a component as field, just a placeholder, hence no need to store the value
export interface CreateComponentAttributeDTO extends CreateAttributeBaseDTO {
  componentRefId: string;
}

// used when the user add a dynamic as field, just a placeholder, hence no need to store the value
export interface CreateDynamicZoneAttributeDTO extends CreateAttributeBaseDTO {
  componentRefIds: string[];
}

export interface UpdateAttributeBaseDto {
  label?: string;
  required?: boolean;
}

export interface UpdatePrimitiveAttributeDTO extends UpdateAttributeBaseDto {
  // attributeType: AttributeTypeEnum;  Not supported yet
  localizable?: boolean;
  // attributeFormat?: AttributeFormatEnum; Not supported yet
  defaultValue?: any;
  enumValues?: string[];
  // validation?: ValidationRules; Not supported yet
}

export interface DeleteAttributeResponse {
  status: "success" | "failed";
  data: any;
}
