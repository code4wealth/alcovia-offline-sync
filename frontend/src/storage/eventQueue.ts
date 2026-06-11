import { SyncEvent } from "../../../shared/types";
import { loadState, saveState } from "./db";

export async function enqueueEvent(event: SyncEvent): Promise<void> {
  const state = await loadState();
  state.pendingEvents.push(event);
  await saveState(state);
}

export async function dequeueEvents(): Promise<SyncEvent[]> {
  const state = await loadState();
  return [...state.pendingEvents];
}

export async function markSynced(eventIds: string[]): Promise<void> {
  const state = await loadState();
  const idSet = new Set(eventIds);
  state.pendingEvents = state.pendingEvents.filter(
    (e) => !idSet.has(e.eventId)
  );
  await saveState(state);
}
