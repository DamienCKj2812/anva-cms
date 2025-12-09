import Ajv from "ajv";
import addFormats from "ajv-formats";
import { ValidationError } from "./helper.errors";
import { Attribute } from "../module/attribute/database/models";

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

export function recursiveKeyCleaner(data: any, keyToDelete: string): any {
  // 1. Base Case: If the data is a primitive, return it as is.
  if (typeof data !== "object" || data === null) {
    return data;
  }

  // 2. Handle Arrays
  if (Array.isArray(data)) {
    // Traverse each item and apply the cleaning function recursively.
    return data.map((item) => recursiveKeyCleaner(item, keyToDelete));
  }

  // 3. Handle Objects
  const cleanedObject = {};
  for (const key in data) {
    if (data.hasOwnProperty(key)) {
      const value = data[key];

      // --- DELETION RULES ---

      // Rule 1: Remove if the KEY name matches the specified criteria
      if (key === keyToDelete) {
        // Skip this key/value pair.
        continue;
      }

      // Rule 2: Remove if the VALUE is an empty string
      if (value === "") {
        // Skip this key/value pair.
        continue;
      }

      // --- RECURSION ---

      // If the value is a nested object or array, recursively clean it.
      if (typeof value === "object" && value !== null) {
        cleanedObject[key] = recursiveKeyCleaner(value, keyToDelete);
      } else {
        // Otherwise, copy the key-value pair as is.
        cleanedObject[key] = value;
      }
    }
  }

  return cleanedObject;
}

export function filterSchemaByLocalizable(schema: any, localizable: boolean): any {
  if (!schema) return null;

  // PRIMITIVE
  if (!schema.type || (schema.type !== "object" && schema.type !== "array")) {
    const includePrimitive = (localizable && schema.localizable) || (!localizable && !schema.localizable);
    return includePrimitive ? schema : null;
  }

  // OBJECT
  if (schema.type === "object") {
    const filteredProps: any = {};
    const newRequired: string[] = [];

    for (const [key, prop] of Object.entries(schema.properties || {})) {
      const filteredProp = filterSchemaByLocalizable(prop, localizable);

      if (filteredProp) {
        filteredProps[key] = filteredProp;
        if (schema.required?.includes(key)) {
          newRequired.push(key);
        }
      }
    }

    if (Object.keys(filteredProps).length === 0) {
      // No localizable fields inside → remove the object entirely
      return null;
    }

    return {
      ...schema,
      properties: filteredProps,
      ...(newRequired.length > 0 ? { required: newRequired } : {}),
    };
  }

  // ARRAY
  if (schema.type === "array") {
    const filteredItems = filterSchemaByLocalizable(schema.items, localizable);

    if (!filteredItems) {
      // No localizable fields inside → remove the array entirely
      return null;
    }

    return {
      ...schema,
      items: filteredItems,
    };
  }

  return null;
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
