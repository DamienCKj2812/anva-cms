import bcrypt from "bcryptjs";
import { ObjectId } from "mongodb";
import { UnauthorizedError } from "./helper.errors";
import { AppContext } from "./helper.context";

export const hashPassword = async (password: string): Promise<string> => {
  return await bcrypt.hash(password, 10);
};

export const verifyPassword = async (password: string, hash: string): Promise<boolean> => {
  return await bcrypt.compare(password, hash);
};

// Get the _id of the current logged in user
export function getCurrentUserId(context: AppContext): ObjectId {
  if (!context.currentUser?.id) {
    throw new UnauthorizedError("User not authenticated");
  }

  return ObjectId.createFromHexString(context.currentUser.id);
}
