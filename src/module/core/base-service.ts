import { AppContext } from "../../utils/helper.context";
import { ServiceMap } from "../../utils/helper.diContainer";

export abstract class BaseService {
  protected context: AppContext;

  constructor(context: AppContext) {
    this.context = context;
  }

  protected getService<K extends keyof ServiceMap>(key: K): ServiceMap[K] {
    if (!this.context.diContainer) throw new Error("DIContainer not initialized");
    return this.context.diContainer.get<K>(key);
  }
}
