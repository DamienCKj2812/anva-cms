import { EventEmitter } from "events";
import { SectionContent } from "../module/section-content/database/model";

const globalEventBus = new EventEmitter();

export interface CreditsUpdatedEvent {
  profileId: string;
  newBalance: number;
}

export interface SectionRoomCountUpdatedEvent {
  sectionId: string;
  action: "increment" | "decrement";
}

export interface BackendAppEvents {
  "llm:sectionContentCreated": (data: SectionContent) => void;
  "profile:creditsUpdated": (data: CreditsUpdatedEvent) => void;
  "section:sectionRoomSettingCountUpdated": (data: SectionRoomCountUpdatedEvent) => void;
}

// Increase the maximum number of listeners if got warnings.
// !Remember clean up the listener
globalEventBus.setMaxListeners(100);

export function logAllListeners() {
  const events = globalEventBus.eventNames();

  console.log("\n\n==== Global Event Bus Listeners ====");
  for (const event of events) {
    const count = globalEventBus.listenerCount(event);
    console.log(`Event "${String(event)}" has ${count} listener(s)`);
    const listeners = globalEventBus.listeners(event);
    listeners.forEach((listener, index) => {
      console.log(`  Listener ${index + 1}:`, listener.toString().slice(0, 100) + "...");
    });
  }
  console.log("====================================");
}

export default globalEventBus;
