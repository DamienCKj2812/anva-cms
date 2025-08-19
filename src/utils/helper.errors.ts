import { NextFunction, Request, Response } from "express";
import { errorResponse } from "./helper.response";

export enum AppError {
  VALIDATION = "ValidationError",
  NOT_FOUND = "NotFoundError",
  UNAUTHORIZED = "UnauthorizedError",
  FORBIDDEN = "ForbiddenError",
  CONFLICT = "ConflictError",
  BAD_REQUEST = "BadRequestError",
  INTERNAL = "InternalServerError",
}

export enum HttpStatusCode {
  VALIDATION = 400,
  BAD_REQUEST = 400,
  UNAUTHORIZED = 401,
  FORBIDDEN = 403,
  NOT_FOUND = 404,
  CONFLICT = 409,
  INTERNAL_SERVER = 500,
}

export class AppBaseError extends Error {
  constructor(
    public readonly name: AppError,
    public readonly statusCode: HttpStatusCode,
    message: string
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ValidationError extends AppBaseError {
  constructor(message: string) {
    super(AppError.VALIDATION, HttpStatusCode.VALIDATION, message);
  }
}

export class NotFoundError extends AppBaseError {
  constructor(message: string) {
    super(AppError.NOT_FOUND, HttpStatusCode.NOT_FOUND, message);
  }
}

export class UnauthorizedError extends AppBaseError {
  constructor(message: string = "Unauthorized") {
    super(AppError.UNAUTHORIZED, HttpStatusCode.UNAUTHORIZED, message);
  }
}

export class ForbiddenError extends AppBaseError {
  constructor(message: string = "Forbidden") {
    super(AppError.FORBIDDEN, HttpStatusCode.FORBIDDEN, message);
  }
}

export class ConflictError extends AppBaseError {
  constructor(message: string) {
    super(AppError.CONFLICT, HttpStatusCode.CONFLICT, message);
  }
}

export class BadRequestError extends AppBaseError {
  constructor(message: string = "Invalid request format") {
    super(AppError.BAD_REQUEST, HttpStatusCode.BAD_REQUEST, message);
  }
}

export class InternalServerError extends AppBaseError {
  constructor(message: string = "Internal Server Error") {
    super(AppError.INTERNAL, HttpStatusCode.INTERNAL_SERVER, message);
  }
}

// Global error handler middleware
export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  console.error(err.stack);

  const statusCode = err.statusCode || HttpStatusCode.INTERNAL_SERVER;
  const message = err.message || "Internal Server Error";

  res.status(statusCode).json(errorResponse(message, err));
};
