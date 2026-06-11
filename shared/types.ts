/**
 * Shared domain types for Alcovia (offline-first study sync).
 *
 * These types are imported by both the backend and the frontend. The file has
 * zero runtime dependencies so it can be compiled into either build.
 *
 * Design note on `version`:
 *   `version` is a *logical* clock - a monotonically incrementing integer that
 *   is scoped per entity and incremented on every write. It is NEVER derived
 *   from wall-clock time and is NEVER reset. All merge decisions use `version`
 *   (with `deviceId` as a deterministic tie-breaker). `createdAt` exists for
 *   display only and must never influence merge logic.
 */

export enum EventType {
  TASK_STATUS_CHANGED = "TASK_STATUS_CHANGED",
  SESSION_STARTED = "SESSION_STARTED",
  SESSION_COMPLETED = "SESSION_COMPLETED",
  SESSION_FAILED = "SESSION_FAILED",
}

export enum TaskStatus {
  NOT_STARTED = "NOT_STARTED",
  IN_PROGRESS = "IN_PROGRESS",
  DONE = "DONE",
}

export enum SessionStatus {
  ACTIVE = "ACTIVE",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
}

export enum FailReason {
  GIVE_UP = "give_up",
  APP_SWITCH = "app_switch",
}

/** A single operation/event. Events are the unit of sync (never full snapshots). */
export interface SyncEvent {
  eventId: string; // UUID, stable, never regenerated
  entityId: string; // ID of the entity being modified (taskId or sessionId)
  deviceId: string; // stable per-device identifier
  type: EventType;
  version: number; // monotonic integer per entity, never from wall clock
  payload: Record<string, unknown>; // operation-specific data
  createdAt: number; // display only, never used for merge logic
}

export interface Task {
  taskId: string;
  chapterId: string;
  subjectId: string;
  title: string;
  status: TaskStatus;
  version: number;
  updatedByDevice: string;
}

export interface FocusSession {
  sessionId: string;
  deviceId: string;
  targetDuration: number; // minutes
  status: SessionStatus;
  startedAt: number;
  completedAt?: number;
  rewardProcessed: boolean;
  failReason?: FailReason;
}

/** Canonical reward/progress counters owned by the backend. */
export interface StudentState {
  streak: number;
  coins: number;
  focusMinutesToday: number;
}

/** Everything the frontend persists to durable local storage as one blob. */
export interface LocalState {
  tasks: Record<string, Task>;
  sessions: Record<string, FocusSession>;
  streak: number;
  coins: number;
  focusMinutesToday: number;
  pendingEvents: SyncEvent[];
  /** Server sequence cursor (NOT a wall-clock timestamp). */
  lastSyncedSeq: number;
}

/** Response shape for POST /events. */
export interface IngestResult {
  processed: number;
  skipped: number;
  logs: string[];
}

/** Response shape for GET /sync. */
export interface SyncPullResult {
  events: SyncEvent[];
  student: StudentState;
  maxSeq: number;
}

export const REWARD_COINS = 50;
export const STREAK_DELTA = 1;
