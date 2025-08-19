import { ClientSession, Db, MongoClient } from "mongodb";
import configs from "../configs";
import { ObjectId } from "mongodb";
import { BadRequestError, UnauthorizedError } from "./helper.errors";

class MongoHelper {
  private static instance: MongoHelper;
  private client: MongoClient;
  private db: Db | null = null;

  private constructor() {
    this.client = new MongoClient(configs.MONGODB_URI, {
      ignoreUndefined: true,
    });
  }

  static getInstance(): MongoHelper {
    if (!MongoHelper.instance) {
      MongoHelper.instance = new MongoHelper();
    }
    return MongoHelper.instance;
  }

  async connect(): Promise<Db> {
    if (this.db) return this.db;

    try {
      if (!this.db) {
        await this.client.connect();
        this.db = this.client.db(configs.MONGODB_DATABASE);
      }
      return this.db;
    } catch (error) {
      console.error(error);
      throw error;
    }
  }

  async startSession(): Promise<ClientSession> {
    await this.connect();
    return this.client.startSession({ causalConsistency: true });
  }
}

export const toObjectId = (
  value: string | ObjectId | undefined
): ObjectId | undefined => {
  return typeof value === "string" ? new ObjectId(value) : value;
};

export const validateObjectId = (id: string | ObjectId): void => {
  if (!ObjectId.isValid(id)) {
    throw new BadRequestError(`Invalid ObjectId format: ${id}`);
  }
};

export const validateObjectIds = (ids: string[]) => {
  return (
    Array.isArray(ids) &&
    ids.every((id) => typeof id === "string" && validateObjectId(id))
  );
};

// Helper function to safely identify ObjectId strings
export function isPotentialObjectId(value: any): boolean {
  return (
    typeof value === "string" &&
    /^[0-9a-fA-F]{24}$/.test(value) &&
    ObjectId.isValid(value)
  );
}

/**
 * Recursively converts all string values that match ObjectId pattern
 */
export function convertObjectIds(data: any): any {
  // 1. Handle arrays
  if (Array.isArray(data)) {
    return data.map((item) => convertObjectIds(item));
  }

  // 2. Handle objects
  if (data && typeof data === "object" && !(data instanceof ObjectId)) {
    return Object.fromEntries(
      Object.entries(data).map(([key, value]) => [key, convertObjectIds(value)])
    );
  }

  // 3. Convert valid ObjectId strings
  if (isPotentialObjectId(data)) {
    return toObjectId(data);
  }

  // 4. Return unchanged for all other types
  return data;
}

export default MongoHelper;
