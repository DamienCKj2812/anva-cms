import { Collection, Document, WithId, ObjectId } from "mongodb";
import { Request, Response, NextFunction } from "express";
import { AppContext } from "../utils/helper.context";
import fs from "fs/promises";
import { format } from "date-fns";

// Validate the media folder to prevent unnecessary file uploads
export function validateFolderExists(context: AppContext) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
    } catch (error) {
      throw error;
    }
  };
}

// Filter invalid fields when performing updates to a database document
export function filterFields<T extends object>(data: T, allowedFields: ReadonlySet<keyof T>): Partial<T> {
  return Object.fromEntries(Object.entries(data).filter(([key]) => allowedFields.has(key as keyof T))) as Partial<T>;
}

export interface QueryOptions<T extends Document = Document> {
  /**
   * Filter criteria (MongoDB query syntax)
   * @example { status: "active" }
   */
  filter?: Filter<T>;

  /**
   * Sort order (1 = ascending, -1 = descending)
   * @example { createdAt: -1 } // Newest first
   */
  sort?: Sort<T>;

  /**
   * Number of documents per page
   * @default 10
   */
  limit?: number;

  /**
   * Current page number (1-based index)
   * @default 1
   */
  page?: number;

  /**
   * Field projection (1 = include, 0 = exclude)
   * @example { _id: 0, name: 1 } // Exclude _id, include name
   */
  projection?: Projection<T>;
}

// Helper types (can be exported if needed elsewhere)
type Filter<T> = {
  [K in keyof T]?: T[K] | { [operator in MongoDBQueryOperators]?: any };
} & {
  [key: string]: any; // Allow raw MongoDB operators ($and, $or, etc.)
};

type Sort<T> = Partial<Record<keyof T, 1 | -1>>;
type Projection<T> = Partial<Record<keyof T, 1 | 0>>;

type MongoDBQueryOperators = "$eq" | "$ne" | "$gt" | "$gte" | "$lt" | "$lte" | "$in" | "$nin" | "$exists" | "$regex";

export type WithMetaData<T> = {
  data: T[];
  metadata: {
    totalCount: number;
    currentPage: number; // current
    totalPages: number;
    nextPage: number | null;
    previousPage: number | null;
    pageSize: number; // limit
  };
};

// Function used by all getAll() function in each module
export async function findWithOptions<T extends Document>(collection: Collection<T>, options: QueryOptions) {
  const { filter = {}, sort = {}, projection } = options;
  const limit = options.limit ?? 10;
  const page = options.page ?? 1;

  const processedFilter = convertStringIdsToObjectIds(filter);

  const pipeline: Document[] = [{ $match: processedFilter }];

  // Projection last
  if (projection && Object.keys(projection).length > 0) {
    pipeline.push({ $project: projection });
  }

  if (Object.keys(sort).length > 0) {
    pipeline.push({ $sort: sort });
  }

  // Add pagination + metadata
  const paginatedPipeline = appendPaginationAndMetadata(pipeline, page, limit);

  const result = await collection.aggregate(paginatedPipeline).toArray();

  return parseFacetMetadata(result, page, limit);
}

export function appendPaginationAndMetadata(pipeline: Document[], page: number = 1, limit: number = 10): Document[] {
  const skip = (page - 1) * limit;

  return [
    ...pipeline,
    {
      $facet: {
        metadata: [{ $count: "totalCount" }],
        data: [{ $skip: skip }, ...(limit > 0 ? [{ $limit: limit }] : [])],
      },
    },
  ];
}

/**
 * Extracts clean metadata object from a $facet aggregation result.
 */
export function parseFacetMetadata(facetResult: any[], page: number, limit: number) {
  const { data, metadata } = facetResult[0] || { data: [], metadata: [] };
  const totalCount = metadata[0]?.totalCount || 0;
  const totalPages = Math.ceil(totalCount / limit);

  return {
    data,
    metadata: {
      totalCount,
      currentPage: page,
      totalPages,
      nextPage: page < totalPages ? page + 1 : null,
      previousPage: page > 1 ? page - 1 : null,
      pageSize: limit,
    },
  };
}

// Convert string ids to ObjectId
// For fields like _id, profileId
function convertStringIdsToObjectIds(filter: any): any {
  if (!filter || typeof filter !== "object") {
    return filter;
  }

  if (filter instanceof ObjectId) {
    return filter;
  }

  const result: any = {};
  for (const key in filter) {
    // Handle ALL $in arrays
    if (filter[key]?.$in && Array.isArray(filter[key].$in)) {
      result[key] = {
        $in: filter[key].$in.map(
          (item: any) =>
            (key === "_id" || key.endsWith("._id") || key.endsWith("Id")) && typeof item === "string" && ObjectId.isValid(item)
              ? new ObjectId(item)
              : item // Preserve non-ID values
        ),
      };
    }
    // Normal ID conversion
    else if (key === "_id" || key.endsWith("._id") || key.endsWith("Id")) {
      result[key] = typeof filter[key] === "string" && ObjectId.isValid(filter[key]) ? new ObjectId(filter[key]) : filter[key];
    }
    // Recursive handling
    else {
      result[key] = convertStringIdsToObjectIds(filter[key]);
    }
  }

  return result;
}

// Parse JSONs of FormData
export const autoParseJSON = () => (req: Request, res: Response, next: NextFunction) => {
  for (const key in req.body) {
    const value = req.body[key];

    if (typeof value !== "string") continue;

    try {
      // Try parsing JSON for objects and arrays
      if (value.startsWith("{") || value.startsWith("[")) {
        req.body[key] = JSON.parse(value);
      }
      // Handle boolean
      else if (value === "true") {
        req.body[key] = true;
      } else if (value === "false") {
        req.body[key] = false;
      }
      // Handle null
      else if (value === "null") {
        req.body[key] = null;
      }
      // not able to convert number because some string may contains only numbers
      // otherwise leave as string
    } catch (err) {
      console.warn(`Failed to auto-parse req.body["${key}"]:`, err);
    }
  }

  next();
};

/**
 * Delete uploaded files
 */
export async function cleanupUploadedFiles(req: any): Promise<void> {
  try {
    const files: Express.Multer.File[] = [];

    // Single file upload: req.file
    if (req.file) {
      files.push(req.file);
    }

    // Multiple files
    if (req.files) {
      if (Array.isArray(req.files)) {
        files.push(...req.files);
      } else if (typeof req.files === "object") {
        for (const key in req.files) {
          const group = req.files[key];
          if (Array.isArray(group)) {
            files.push(...group);
          }
        }
      }
    }

    // Remove files
    await Promise.all(files.map((file) => fs.unlink(file.path).catch((err) => console.warn(`Failed to delete file '${file.path}':`, err))));
  } catch (err) {
    console.error("Error during uploaded file cleanup:", err);
  }
}

// eg: Jun 15, 2025 at 2:30 PM
export function formatDateTime(date: Date) {
  return format(new Date(), "MMM d, yyyy 'at' h:mm a");
}

export function getTextSnippet(text: string, query: string, radius = 30): string {
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1) return text.slice(0, radius) + "...";

  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + query.length + radius);
  return (start > 0 ? "..." : "") + text.slice(start, end) + (end < text.length ? "..." : "");
}

export function findKeywordMatches(content: string | string[], query: string): { line: number; text: string }[] {
  const lines = Array.isArray(content) ? content.flatMap((block) => block.split("\n")) : content.split("\n");

  return lines.map((text, index) => ({ line: index + 1, text })).filter((line) => line.text.toLowerCase().includes(query.toLowerCase()));
}
