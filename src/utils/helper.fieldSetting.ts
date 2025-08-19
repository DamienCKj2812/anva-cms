import { NextFunction, Request, RequestHandler, Response } from "express";
import { autoParseJSON, cleanupUploadedFiles } from "./helper";
import { AppContext } from "./helper.context";
import { ObjectId } from "mongodb";

// Fieldsetting middleware
export function withDynamicFieldSettings(moduleCollectionName: string, context: AppContext): RequestHandler[] {
  return [
    (req, res, next) => next(),
    autoParseJSON(),
    async (req, res, next) => {
      try {
        // No logic yet
        next();
      } catch (err) {
        next(err);
      }
    },
  ];
}
