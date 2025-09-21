import { Db } from "mongodb";
import { DIContainer } from "./helper.diContainer";
import { ContextUser } from "../module/user/database/models";

export interface AppContext {
  mongoDatabase: Db;
  currentUser: ContextUser | null;
  diContainer: DIContainer | null;
  orgBucketName: string | null;
}

function createAppContext(db: Db): AppContext {
  const context: Partial<AppContext> = {
    mongoDatabase: db,
    currentUser: null,
    diContainer: null,
    orgBucketName: null,
  };

  return context as AppContext;
}

export default createAppContext;
