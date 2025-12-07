import Ajv from "ajv";
import addFormats from "ajv-formats";
import { ValidationError } from "./helper.errors";

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

export function filterSchemaByLocalizable(schema: any, localizable: boolean): any {
  if (!schema) return null;

  // OBJECT
  if (schema.type === "object") {
    const filteredProps: any = {};
    const newRequired: string[] = [];

    for (const [key, prop] of Object.entries(schema.properties || {})) {
      let filteredProp: any = null;

      // Nested object or array → recurse
      if (prop.type === "object" || prop.type === "array") {
        filteredProp = filterSchemaByLocalizable(prop, localizable);
        // Preserve container even if empty to prevent AJV errors
        if (!filteredProp) {
          // Keep an empty structure if it was a nested object/array
          filteredProp =
            prop.type === "object"
              ? { ...prop, properties: {}, required: [], additionalProperties: prop.additionalProperties ?? false }
              : { ...prop, items: prop.items ?? {} };
        }
      } else {
        // Primitive field → filter by localizable
        const includePrimitive = (localizable && prop.localizable) || (!localizable && !prop.localizable);
        if (includePrimitive) filteredProp = prop;
      }

      if (filteredProp) {
        filteredProps[key] = filteredProp;
        if (schema.required?.includes(key)) newRequired.push(key);
      }
    }

    return {
      ...schema,
      properties: filteredProps,
      ...(newRequired.length > 0 ? { required: newRequired } : {}),
    };
  }

  // ARRAY
  if (schema.type === "array") {
    const filteredItems = filterSchemaByLocalizable(schema.items, localizable) || schema.items || {};
    return { ...schema, items: filteredItems };
  }

  // PRIMITIVE
  const includePrimitive = (localizable && schema.localizable) || (!localizable && !schema.localizable);
  return includePrimitive ? schema : null;
}
