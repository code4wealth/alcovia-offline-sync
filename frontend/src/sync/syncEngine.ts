import {
  SyncEvent,
  EventType,
  TaskStatus,
  FailReason,
  IngestResult,
  SyncPullResult,
  SessionStatus,
  REWARD_COINS,
  STREAK_DELTA,
} from "../../../shared/types";
import { loadState, saveState } from "../storage/db";
import { getDeviceId } from "../storage/deviceId";
import { markSynced } from "../storage/eventQueue";
import {
  applyTaskUpdate,
  applySessionEvent,
  applyReward,
} from "../storage/localMutations";

export type SyncLog = { time: number; msg: string };

let _online = true;
let _apiUrl = "http://localhost:3001";

const _syncLogs: SyncLog[] = [];
const _notificationLogs: string[] = [];

export function setApiUrl(url: string): void {
  _apiUrl = url;
}

export function getApiUrl(): string {
  return _apiUrl;
}

export function setOnlineStatus(v: boolean): void {
  _online = v;
  if (v) {
    sync().catch(() => {});
  }
}

export function getOnlineStatus(): boolean {
  return _online;
}

export function getSyncLogs(): SyncLog[] {
  return _syncLogs;
}

export function getNotificationLogs(): string[] {
  return _notificationLogs;
}

function log(msg: string): SyncLog {
  const entry: SyncLog = { time: Date.now(), msg };
  _syncLogs.push(entry);
  // keep last 200
  if (_syncLogs.length > 200) _syncLogs.splice(0, _syncLogs.length - 200);
  return entry;
}

export async function sync(): Promise<SyncLog[]> {
  const logs: SyncLog[] = [];
  const addLog = (msg: string) => {
    logs.push(log(msg));
  };

  if (!_online) {
    addLog("SYNC_SKIPPED_OFFLINE");
    return logs;
  }

  const state = await loadState();
  const deviceId = await getDeviceId();

  // ── PUSH ──────────────────────────────────────────
  if (state.pendingEvents.length > 0) {
    try {
      const res = await fetch(`${_apiUrl}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state.pendingEvents),
      });
      const data: IngestResult = await res.json();
      for (const l of data.logs) {
        addLog(l);
      }
      await markSynced(state.pendingEvents.map((e) => e.eventId));
    } catch (err) {
      addLog(`SYNC_PUSH_ERROR: ${String(err)}`);
      return logs;
    }
  }

  // ── PULL ──────────────────────────────────────────
  try {
    const freshState = await loadState();
    const res = await fetch(
      `${_apiUrl}/sync?since=${freshState.lastSyncedSeq}&deviceId=${deviceId}`
    );
    const data: SyncPullResult = await res.json();

    for (const evt of data.events) {
      await applyRemoteEvent(evt, addLog);
    }

    // adopt canonical student state from backend
    const updated = await loadState();
    updated.streak = data.student.streak;
    updated.coins = data.student.coins;
    updated.focusMinutesToday = data.student.focusMinutesToday;
    updated.lastSyncedSeq = data.maxSeq;
    await saveState(updated);

    addLog(`SYNC_COMPLETE seq=${data.maxSeq}`);
  } catch (err) {
    addLog(`SYNC_PULL_ERROR: ${String(err)}`);
  }

  return logs;
}

async function applyRemoteEvent(
  evt: SyncEvent,
  addLog: (msg: string) => void
): Promise<void> {
  switch (evt.type) {
    case EventType.TASK_STATUS_CHANGED: {
      const result = await applyTaskUpdate(
        evt.entityId,
        evt.payload.status as TaskStatus,
        evt.version,
        evt.deviceId
      );
      addLog(
        `CONFLICT_RESOLVED entity=[${evt.entityId}] winner=[${result.winner}] version=[${result.winVersion}]`
      );
      break;
    }
    case EventType.SESSION_COMPLETED: {
      await applySessionEvent({
        sessionId: evt.entityId,
        deviceId: evt.deviceId,
        targetDuration: (evt.payload.targetDuration as number) || 0,
        status: SessionStatus.COMPLETED,
        startedAt: (evt.payload.startedAt as number) || 0,
        completedAt: (evt.payload.completedAt as number) || Date.now(),
        rewardProcessed: false,
      });
      const rewarded = await applyReward(
        evt.entityId,
        REWARD_COINS,
        STREAK_DELTA,
        (evt.payload.targetDuration as number) || 0
      );
      if (!rewarded) {
        addLog(`REWARD_ALREADY_PROCESSED [${evt.entityId}]`);
      }
      _notificationLogs.push(
        `N8N_NOTIFICATION_SENT [${evt.entityId}]`
      );
      break;
    }
    case EventType.SESSION_FAILED: {
      await applySessionEvent({
        sessionId: evt.entityId,
        deviceId: evt.deviceId,
        targetDuration: (evt.payload.targetDuration as number) || 0,
        status: SessionStatus.FAILED,
        startedAt: (evt.payload.startedAt as number) || 0,
        failReason: evt.payload.failReason as FailReason | undefined,
      });
      break;
    }
    case EventType.SESSION_STARTED: {
      await applySessionEvent({
        sessionId: evt.entityId,
        deviceId: evt.deviceId,
        targetDuration: (evt.payload.targetDuration as number) || 0,
        status: SessionStatus.ACTIVE,
        startedAt: (evt.payload.startedAt as number) || Date.now(),
      });
      break;
    }
  }
  addLog(`EVENT_SYNCED [${evt.eventId}]`);
}
