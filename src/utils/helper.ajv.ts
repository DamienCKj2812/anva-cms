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

export function recursiveReplace(target: any, source: any): any {
  if (source === undefined) {
    return target;
  }

  if (Array.isArray(source)) {
    return source;
  }

  if (source && typeof source === "object") {
    target = target || {};
    for (const key of Object.keys(source)) {
      target[key] = recursiveReplace(target[key], source[key]);
    }
    return target;
  }

  return source;
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
    return { shared: null, translation: null };
  }

  // ARRAY case
  if (schema.type === "array" && schema.items) {
    const validArray = Array.isArray(data) ? data.filter((item) => item != null) : [];
    const sharedArr: any[] = [];
    const transArr: any[] = [];

    for (const item of validArray) {
      const separated = separateTranslatableFields(item, schema.items);
      if (separated.shared) sharedArr.push(separated.shared);
      if (separated.translation) transArr.push(separated.translation);
    }

    return {
      shared: sharedArr.length > 0 ? sharedArr : null,
      translation: transArr.length > 0 ? transArr : null,
    };
  }

  // OBJECT case
  if (schema.type === "object") {
    if (typeof data !== "object") return { shared: null, translation: null };

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
        if (separated.shared !== null) shared[key] = separated.shared;
        if (separated.translation !== null) translation[key] = separated.translation;
      } else {
        if (fieldSchema.localizable) {
          translation[key] = fieldValue;
        } else {
          shared[key] = fieldValue;
        }
      }
    }

    return {
      shared: Object.keys(shared).length > 0 ? shared : null,
      translation: Object.keys(translation).length > 0 ? translation : null,
    };
  }

  // PRIMITIVE fallback
  return {
    shared: schema.localizable ? null : data,
    translation: schema.localizable ? data : null,
  };
}

export function rebuild(data: any, schema: any): any {
  if (!schema) {
    return null;
  }

  if (schema.type === "object") {
    if (Array.isArray(data)) {
      return rebuild(data[0] ?? {}, schema);
    }
    return rebuildObject(data ?? {}, schema);
  }

  if (schema.type === "array") {
    return rebuildArray(data, schema);
  }

  return castPrimitive(data, schema.type, schema.defaultValue);
}

function rebuildObject(data: any, schema: any) {
  const output: any = {};

  for (const key of Object.keys(schema.properties || {})) {
    const fieldSchema = schema.properties[key];
    const existing = data?.[key];

    if (existing === undefined) {
      output[key] = createDefault(fieldSchema);
    } else {
      output[key] = rebuild(existing, fieldSchema);
    }
  }

  // If no properties and the original data was not an object, still return {}
  return output;
}

function rebuildArray(data: any, schema: any) {
  // If data is undefined/null -> default []
  if (data === undefined || data === null) return [];

  // If data is not an array -> wrap
  if (!Array.isArray(data)) {
    return [rebuild(data, schema.items)];
  }

  return data.map((it: any) => rebuild(it, schema.items));
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
  } catch (e) {
    if (defaultValue !== undefined) return deepClone(defaultValue);
    // fallback
    return null;
  }
}

function createDefault(schema: any) {
  if (schema.defaultValue !== undefined) return deepClone(schema.defaultValue);

  if (schema.type === "object") return rebuildObject({}, schema);
  if (schema.type === "array") return [];

  // primitive
  return castPrimitive(undefined, schema.type);
}
