import {
  TaskStatus,
  FocusSession,
  SessionStatus,
} from "../../../shared/types";
import { loadState, saveState } from "./db";

/**
 * LWW merge for task status.
 * Rule: higher version wins. Equal version => higher deviceId (lexicographic) wins.
 * Returns the winning deviceId for logging.
 */
export async function applyTaskUpdate(
  taskId: string,
  status: TaskStatus,
  version: number,
  deviceId: string
): Promise<{ applied: boolean; winner: string; winVersion: number }> {
  const state = await loadState();
  const existing = state.tasks[taskId];

  if (!existing) {
    // new task — shouldn't happen with seeds, but handle gracefully
    state.tasks[taskId] = {
      taskId,
      chapterId: "",
      subjectId: "",
      title: taskId,
      status,
      version,
      updatedByDevice: deviceId,
    };
    await saveState(state);
    return { applied: true, winner: deviceId, winVersion: version };
  }

  const incomingWins =
    version > existing.version ||
    (version === existing.version && deviceId > existing.updatedByDevice);

  if (incomingWins) {
    existing.status = status;
    existing.version = version;
    existing.updatedByDevice = deviceId;
    await saveState(state);
    return { applied: true, winner: deviceId, winVersion: version };
  }

  return {
    applied: false,
    winner: existing.updatedByDevice,
    winVersion: existing.version,
  };
}

export async function applySessionEvent(
  session: Partial<FocusSession> & { sessionId: string }
): Promise<void> {
  const state = await loadState();
  const existing = state.sessions[session.sessionId];
  if (existing) {
    // update non-undefined fields
    if (session.status !== undefined) existing.status = session.status;
    if (session.completedAt !== undefined)
      existing.completedAt = session.completedAt;
    if (session.failReason !== undefined)
      existing.failReason = session.failReason;
  } else {
    state.sessions[session.sessionId] = {
      sessionId: session.sessionId,
      deviceId: session.deviceId || "",
      targetDuration: session.targetDuration || 0,
      status: session.status || SessionStatus.ACTIVE,
      startedAt: session.startedAt || Date.now(),
      completedAt: session.completedAt,
      rewardProcessed: session.rewardProcessed || false,
      failReason: session.failReason,
    };
  }
  await saveState(state);
}

/**
 * Idempotent reward application.
 * If rewardProcessed is already true for this session, skip entirely.
 */
export async function applyReward(
  sessionId: string,
  coins: number,
  streakDelta: number,
  minutes: number
): Promise<boolean> {
  const state = await loadState();
  const session = state.sessions[sessionId];
  if (session && session.rewardProcessed) {
    return false; // already processed — skip
  }
  state.coins += coins;
  state.streak += streakDelta;
  state.focusMinutesToday += minutes;
  if (session) {
    session.rewardProcessed = true;
  }
  await saveState(state);
  return true;
}
