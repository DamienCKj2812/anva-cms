import { Db } from "mongodb";
import { ContextProfile } from "../module/profiles/database/models";
import { DIContainer } from "./helper.diContainer";

export interface AppContext {
  mongoDatabase: Db;
  currentProfile: ContextProfile | null;
  diContainer: DIContainer | null;
}

function createAppContext(db: Db): AppContext {
  const context: Partial<AppContext> = {
    mongoDatabase: db,
    currentProfile: null,
    diContainer: null,
  };

  return context as AppContext;
}

export default createAppContext;
