import Ajv from "ajv";
import addFormats from "ajv-formats";
import { ValidationError } from "./helper.errors";
import { Attribute, AttributeTypeEnum } from "../module/attribute/database/models";
import { deepClone } from "./helper";

export enum AjvSchemaKeywordEnum {
  TYPE = "type",
}

const ajv = new Ajv({ allErrors: true, strict: false });

// Register standard formats: uri, date-time, date, time, etc.
addFormats(ajv);

ajv.addKeyword({
  keyword: "isComponent",
  type: "object",
  errors: false,
  validate: (_schema, data) => {
    if (_schema.isComponent && !data._merged) {
      throw new Error(`Component property detected. Please merge the component schema using mergeTranslatableFields.`);
    }
    return true;
  },
});

ajv.addFormat("media-uri", {
  type: "string",
  validate: (value: string) => {
    return typeof value === "string" && (value.startsWith("/uploads/") || value.startsWith("http://") || value.startsWith("https://"));
  },
});

export default ajv;

export function preValidateComponentPlaceholders(schema: any, path = "data") {
  if (!schema || typeof schema !== "object") {
    throw new ValidationError(`Invalid schema at "${path}". Expected an object, but received ${typeof schema}`);
  }

  if (schema.isComponent || schema.type === "component") {
    throw new ValidationError(`Component detected at "${path}". Please merge the component schema using mergeTranslatableFields before validating.`);
  }

  if (schema.type === "object" && schema.properties) {
    for (const key of Object.keys(schema.properties)) {
      preValidateComponentPlaceholders(schema.properties[key], `${path}/${key}`);
    }
  }

  if (schema.type === "array" && schema.items) {
    preValidateComponentPlaceholders(schema.items, `${path}/*`);
  }
}

export function splitSchemaByLocalizable(schema: any): {
  sharedSchema: any | null;
  localizableSchema: any | null;
} {
  if (!schema) return { sharedSchema: null, localizableSchema: null };

  // PRIMITIVE
  if (!schema.type || (schema.type !== "object" && schema.type !== "array")) {
    const isLocalizable = !!schema.localizable;

    return {
      sharedSchema: isLocalizable ? null : schema,
      localizableSchema: isLocalizable ? schema : null,
    };
  }

  // OBJECT
  if (schema.type === "object") {
    const sharedProps: any = {};
    const sharedRequired: string[] = [];
    const localProps: any = {};
    const localRequired: string[] = [];

    for (const [key, prop] of Object.entries(schema.properties || {})) {
      const { sharedSchema, localizableSchema } = splitSchemaByLocalizable(prop);

      if (sharedSchema) {
        sharedProps[key] = sharedSchema;
        if (schema.required?.includes(key)) sharedRequired.push(key);
      }

      if (localizableSchema) {
        localProps[key] = localizableSchema;
        if (schema.required?.includes(key)) localRequired.push(key);
      }
    }

    return {
      sharedSchema:
        Object.keys(sharedProps).length > 0
          ? {
              ...schema,
              properties: sharedProps,
              ...(sharedRequired.length ? { required: sharedRequired } : {}),
            }
          : null,

      localizableSchema:
        Object.keys(localProps).length > 0
          ? {
              ...schema,
              properties: localProps,
              ...(localRequired.length ? { required: localRequired } : {}),
            }
          : null,
    };
  }

  // ARRAY
  if (schema.type === "array") {
    const { sharedSchema: sharedItems, localizableSchema: localItems } = splitSchemaByLocalizable(schema.items);

    return {
      sharedSchema: sharedItems ? { ...schema, items: sharedItems } : null,
      localizableSchema: localItems ? { ...schema, items: localItems } : null,
    };
  }

  return { sharedSchema: null, localizableSchema: null };
}

// Need to sort the shared and translation correctly by contentId
export function mergeTranslatableFields(shared: any, translation: any, schema: any): any {
  if (!schema) return shared ?? translation ?? null;

  // ARRAY CASE (index-based merge)
  if (schema.type === "array" && schema.items) {
    const sharedArr = Array.isArray(shared) ? shared : [];
    const transArr = Array.isArray(translation) ? translation : [];

    const maxLen = Math.max(sharedArr.length, transArr.length);

    const result: any[] = [];
    for (let i = 0; i < maxLen; i++) {
      const sItem = sharedArr[i] ?? null;
      const tItem = transArr[i] ?? null;

      const merged = mergeTranslatableFields(sItem, tItem, schema.items);
      result.push(merged);
    }

    return result;
  }

  // OBJECT CASE
  if (schema.type === "object" && schema.properties) {
    const result: any = {};

    for (const key of Object.keys(schema.properties)) {
      const fieldSchema = schema.properties[key];

      const sValue = shared?.[key];
      const tValue = translation?.[key];

      // nested array or object → recurse
      if (fieldSchema.type === "array" || fieldSchema.type === "object") {
        const merged = mergeTranslatableFields(sValue, tValue, fieldSchema);

        if (merged !== null && (typeof merged !== "object" || Object.keys(merged).length > 0)) {
          result[key] = merged;
        }
        continue;
      }

      // primitive case
      if (fieldSchema.localizable) {
        if (tValue !== undefined && tValue !== null) {
          result[key] = tValue;
        }
      } else {
        if (sValue !== undefined && sValue !== null) {
          result[key] = sValue;
        }
      }
    }

    return Object.keys(result).length > 0 ? result : null;
  }

  //
  // PRIMITIVE CASE
  //
  if (schema.localizable) {
    return translation ?? null;
  }

  return shared ?? null;
}

/**
 * Recursively separates shared vs translatable fields based on the schema
 */
export function separateTranslatableFields(data: any, schema: any): { shared: any; translation: any } {
  if (!schema || data == null) {
    return { shared: {}, translation: {} };
  }

  // ARRAY case
  if (schema.type === "array" && schema.items) {
    const validArray = Array.isArray(data) ? data.filter((item) => item != null) : [];
    const sharedArr: any[] = [];
    const transArr: any[] = [];

    for (const item of validArray) {
      const separated = separateTranslatableFields(item, schema.items);
      if (Object.keys(separated.shared).length > 0) sharedArr.push(separated.shared);
      if (Object.keys(separated.translation).length > 0) transArr.push(separated.translation);
    }

    return {
      shared: sharedArr,
      translation: transArr,
    };
  }

  // OBJECT case
  if (schema.type === "object") {
    if (typeof data !== "object" || data === null) {
      return { shared: {}, translation: {} };
    }

    const shared: any = {};
    const translation: any = {};

    for (const key of Object.keys(schema.properties || {})) {
      const fieldValue = data[key];
      const fieldSchema = schema.properties[key];

      if (!fieldSchema) {
        shared[key] = fieldValue; // unknown fields treated as shared
        continue;
      }

      if (fieldSchema.type === "object" || fieldSchema.type === "array") {
        const separated = separateTranslatableFields(fieldValue, fieldSchema);
        if (Object.keys(separated.shared).length > 0) shared[key] = separated.shared;
        if (Object.keys(separated.translation).length > 0) translation[key] = separated.translation;
      } else {
        if (fieldSchema.localizable) {
          translation[key] = fieldValue;
        } else {
          shared[key] = fieldValue;
        }
      }
    }

    return { shared, translation };
  }

  // PRIMITIVE fallback
  if (schema.localizable) {
    return { shared: {}, translation: data };
  } else {
    return { shared: data, translation: {} };
  }
}

export function rebuildWithTranslation(sharedData: any, translationData: any, schema: any, forTranslation = false): any {
  if (!schema) return {};

  const schemaLocalizable = isLocalizable(schema);

  // ----- PRIMITIVE CASE -----
  if (schema.type !== "object" && schema.type !== "array") {
    if (!schemaLocalizable) {
      // Shared-only field; fallback to translation if sharedData is missing
      const value = sharedData ?? translationData;
      return castPrimitive(value, schema.type, schema.defaultValue);
    }

    // Localizable field
    return castPrimitive(forTranslation ? (translationData ?? sharedData) : (sharedData ?? translationData), schema.type, schema.defaultValue);
  }

  // ----- OBJECT CASE -----
  if (schema.type === "object") {
    const output: any = {};

    for (const key of Object.keys(schema.properties || {})) {
      const fieldSchema = schema.properties[key];
      const fieldLocalizable = isLocalizable(fieldSchema);

      // Skip fields not belonging in this pass
      if (forTranslation && !fieldLocalizable) continue;
      if (!forTranslation && fieldLocalizable) continue;

      let sharedValue = sharedData?.[key];
      let transValue = translationData?.[key];

      // Array → object promotion per field
      if (fieldSchema.type === "object") {
        if (Array.isArray(sharedValue) && sharedValue.length > 0) sharedValue = sharedValue[0];
        if (Array.isArray(transValue) && transValue.length > 0) transValue = transValue[0];
      }

      output[key] = rebuildWithTranslation(sharedValue, transValue, fieldSchema, forTranslation);
    }

    return output;
  }

  // ----- ARRAY CASE -----
  if (schema.type === "array") {
    let arr: any[];
    let arrOther: any[];

    if (forTranslation) {
      arr = Array.isArray(translationData) ? translationData : translationData != null ? [translationData] : [];
      arrOther = Array.isArray(sharedData) ? sharedData : sharedData != null ? [sharedData] : [];
    } else {
      arr = Array.isArray(sharedData) ? sharedData : sharedData != null ? [sharedData] : [];
      arrOther = Array.isArray(translationData) ? translationData : translationData != null ? [translationData] : [];
    }

    // Fallback: use "other" array if main array is empty
    if (!forTranslation && arr.length === 0 && arrOther.length > 0) arr = arrOther;
    if (forTranslation && arr.length === 0 && arrOther.length > 0) arr = arrOther;

    return arr.map((item, i) =>
      rebuildWithTranslation(forTranslation ? arrOther[i] : item, forTranslation ? item : arrOther[i], schema.items, forTranslation),
    );
  }

  return {};
}

// ----- Helper functions -----

function isLocalizable(schema: any): boolean {
  if (!schema) return false;
  if (schema.localizable) return true;
  if (schema.type === "object" && schema.properties) {
    return Object.values(schema.properties).some(isLocalizable);
  }
  if (schema.type === "array" && schema.items) {
    return isLocalizable(schema.items);
  }
  return false;
}

export function castPrimitive(value: any, type: AttributeTypeEnum, defaultValue?: any) {
  if (value === undefined || value === null) {
    if (defaultValue !== undefined) return deepClone(defaultValue);
    switch (type) {
      case "string":
        return "";
      case "number":
        return 0;
      case "boolean":
        return false;
    }
  }

  try {
    switch (type) {
      case "string":
        return String(value);
      case "number": {
        const n = Number(value);
        return Number.isNaN(n) ? 0 : n;
      }
      case "boolean":
        return Boolean(value);
    }
  } catch {
    if (defaultValue !== undefined) return deepClone(defaultValue);
    return null;
  }
}
