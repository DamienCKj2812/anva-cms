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
  if (Array.isArray(source)) {
    // replace arrays completely
    return source;
  } else if (source && typeof source === "object") {
    target = target || {};
    for (const key of Object.keys(source)) {
      target[key] = recursiveReplace(target[key], source[key]);
    }
    return target;
  } else {
    return source;
  }
}
