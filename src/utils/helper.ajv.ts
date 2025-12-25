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
  validate: (value: string) => /^[a-f\d]{24}$/i.test(value),
});

export default ajv;

export function getMediaUriKeys(schema: any, parentPath = "", result: string[] = []): string[] {
  if (!schema || typeof schema !== "object") return result;

  // Found media-uri
  if (schema.format === "media-uri" && parentPath) {
    result.push(parentPath);
  }

  // Object properties
  if (schema.properties) {
    for (const [key, prop] of Object.entries(schema.properties)) {
      const nextPath = parentPath ? `${parentPath}.${key}` : key;
      getMediaUriKeys(prop, nextPath, result);
    }
  }

  // Array items
  if (schema.items) {
    const arrayPath = parentPath ? `${parentPath}[]` : "[]";

    if (Array.isArray(schema.items)) {
      for (const item of schema.items) {
        getMediaUriKeys(item, arrayPath, result);
      }
    } else {
      getMediaUriKeys(schema.items, arrayPath, result);
    }
  }

  return result;
}

export function getValuesByPaths(data: any, paths: string[]): any[] {
  const results: any[] = [];
  for (const path of paths) {
    collectByPath(data, path.split("."), results);
  }
  return results;
}

function collectByPath(data: any, path: string[], results: any[]) {
  if (!data) return;

  const [head, ...tail] = path;

  // array detection
  const isArray = head.endsWith("[]");
  const key = isArray ? head.slice(0, -2) : head;

  if (tail.length === 0) {
    if (isArray && Array.isArray(data[key])) {
      results.push(...data[key]);
    } else if (data[key] !== undefined) {
      results.push(data[key]);
    }
    return;
  }

  if (isArray && Array.isArray(data[key])) {
    for (const item of data[key]) {
      collectByPath(item, tail, results);
    }
  } else if (data[key] !== undefined) {
    collectByPath(data[key], tail, results);
  }
}

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
  sharedSchema: any;
  localizableSchema: any;
} {
  if (!schema) {
    return {
      sharedSchema: { type: "object", properties: {} },
      localizableSchema: { type: "object", properties: {} },
    };
  }

  // Primitive
  if (!schema.type || (schema.type !== "object" && schema.type !== "array")) {
    const isLocalizable = !!schema.localizable;

    return {
      sharedSchema: isLocalizable ? { type: "object", properties: {} } : schema,
      localizableSchema: isLocalizable ? schema : { type: "object", properties: {} },
    };
  }

  // Object
  if (schema.type === "object") {
    const sharedProps: Record<string, any> = {};
    const sharedRequired: string[] = [];
    const localProps: Record<string, any> = {};
    const localRequired: string[] = [];

    for (const [key, prop] of Object.entries(schema.properties || {}) as [string, any][]) {
      const { sharedSchema, localizableSchema } = splitSchemaByLocalizable(prop);

      if ((sharedSchema && Object.keys(sharedSchema.properties || {}).length > 0) || prop.type !== "object") {
        sharedProps[key] = sharedSchema;
        if (schema.required?.includes(key)) sharedRequired.push(key);
      }

      if ((localizableSchema && Object.keys(localizableSchema.properties || {}).length > 0) || prop.type !== "object") {
        localProps[key] = localizableSchema;
        if (schema.required?.includes(key)) localRequired.push(key);
      }
    }

    return {
      sharedSchema: {
        ...schema,
        properties: sharedProps,
        ...(sharedRequired.length ? { required: sharedRequired } : {}),
      },
      localizableSchema: {
        ...schema,
        properties: localProps,
        ...(localRequired.length ? { required: localRequired } : {}),
      },
    };
  }

  // Array
  if (schema.type === "array") {
    const { sharedSchema: sharedItems, localizableSchema: localItems } = splitSchemaByLocalizable(schema.items);

    return {
      sharedSchema: {
        ...schema,
        items: sharedItems || { type: "object", properties: {} },
      },
      localizableSchema: {
        ...schema,
        items: localItems || { type: "object", properties: {} },
      },
    };
  }

  // Fallback
  return {
    sharedSchema: { type: "object", properties: {} },
    localizableSchema: { type: "object", properties: {} },
  };
}

// Need to sort the shared and translation correctly by contentId
export function mergeTranslatableFields(shared: any, translation: any, schema: any): any {
  if (!schema) return translation ?? shared ?? null;

  // HELPER: Determine if an object is effectively "empty"
  const isEmpty = (val: any) =>
    val === null || val === undefined || (typeof val === "object" && !Array.isArray(val) && Object.keys(val).length === 0);

  // ARRAY CASE
  if (schema.type === "array" && schema.items) {
    const sharedArr = Array.isArray(shared) ? shared : [];
    const transArr = Array.isArray(translation) ? translation : [];

    const maxLen = Math.max(sharedArr.length, transArr.length);
    const result: any[] = [];

    for (let i = 0; i < maxLen; i++) {
      const merged = mergeTranslatableFields(sharedArr[i], transArr[i], schema.items);
      if (merged !== undefined && merged !== null) result.push(merged);
    }

    // Always return at least an empty array if schema is array
    return result.length > 0 ? result : [];
  }

  // OBJECT CASE
  if (schema.type === "object" && schema.properties) {
    const result: any = {};
    const keys = Object.keys(schema.properties);

    for (const key of keys) {
      const merged = mergeTranslatableFields(shared?.[key], translation?.[key], schema.properties[key]);

      // Include merged even if it's an empty array or empty object
      if (merged !== undefined && merged !== null) {
        result[key] = merged;
      }
    }

    // Return result, even if some keys are empty arrays or empty objects
    return Object.keys(result).length > 0 ? result : {};
  }

  // PRIMITIVE CASE
  if (schema.localizable) {
    return translation !== undefined ? translation : null;
  }

  return shared !== undefined ? shared : null;
}

export function mergeTranslatableFieldTest(shared: any, translation: any, schema: any): any {
  if (!schema) return translation ?? shared ?? null;

  if (schema.type === "object" && schema.properties) {
    const result: any = {};

    for (const key of Object.keys(schema.properties)) {
      const fieldSchema = schema.properties[key];

      const merged = mergeTranslatableFields(shared?.[key], translation?.[key], fieldSchema);

      if (merged !== null && merged !== undefined) {
        result[key] = merged;
      }
    }

    return Object.keys(result).length > 0 ? result : null;
  }
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
