import { Router, Request, Response } from "express";
import db from "./db";
import {
  EventType,
  SyncEvent,
  IngestResult,
  SyncPullResult,
  StudentState,
  REWARD_COINS,
  STREAK_DELTA,
} from "../../shared/types";

const router = Router();

/* ── prepared statements ─────────────────────────────────────────── */

const stmtCheckProcessed = db.prepare(
  "SELECT 1 FROM processed_events WHERE eventId = ?"
);
const stmtInsertProcessed = db.prepare(
  "INSERT INTO processed_events (eventId, processedAt) VALUES (?, ?)"
);
const stmtInsertEvent = db.prepare(`
  INSERT INTO events (eventId, entityId, deviceId, type, version, payload, createdAt)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const stmtGetTask = db.prepare("SELECT * FROM tasks WHERE taskId = ?");
const stmtUpsertTask = db.prepare(`
  INSERT INTO tasks (taskId, chapterId, subjectId, title, status, version, updatedByDevice)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(taskId) DO UPDATE SET
    status = excluded.status,
    version = excluded.version,
    updatedByDevice = excluded.updatedByDevice
`);

const stmtGetSession = db.prepare(
  "SELECT * FROM sessions WHERE sessionId = ?"
);
const stmtUpsertSession = db.prepare(`
  INSERT INTO sessions (sessionId, deviceId, targetDuration, status, startedAt, completedAt, rewardProcessed, failReason)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(sessionId) DO UPDATE SET
    status = excluded.status,
    completedAt = excluded.completedAt,
    rewardProcessed = CASE
      WHEN sessions.rewardProcessed = 1 THEN 1
      ELSE excluded.rewardProcessed
    END,
    failReason = excluded.failReason
`);

const stmtGetStudent = db.prepare(
  "SELECT * FROM student WHERE id = 'singleton'"
);
const stmtAwardReward = db.prepare(`
  UPDATE student SET
    coins = coins + ?,
    streak = streak + ?,
    focusMinutesToday = focusMinutesToday + ?
  WHERE id = 'singleton'
`);
const stmtMarkRewardProcessed = db.prepare(
  "UPDATE sessions SET rewardProcessed = 1 WHERE sessionId = ?"
);

const stmtCheckN8n = db.prepare(
  "SELECT 1 FROM n8n_sent WHERE sessionId = ?"
);
const stmtInsertN8n = db.prepare(
  "INSERT INTO n8n_sent (sessionId, sentAt) VALUES (?, ?)"
);

const stmtEventsSince = db.prepare(`
  SELECT * FROM events WHERE serverSeq > ? AND deviceId != ? ORDER BY serverSeq ASC
`);

/* ── transactions ────────────────────────────────────────────────── */

function processReward(
  sessionId: string,
  targetDuration: number,
  logs: string[]
): void {
  const sess = stmtGetSession.get(sessionId) as { rewardProcessed: number } | undefined;
  if (sess && sess.rewardProcessed === 1) {
    logs.push(`REWARD_ALREADY_PROCESSED [${sessionId}]`);
    return;
  }
  stmtAwardReward.run(REWARD_COINS, STREAK_DELTA, targetDuration);
  stmtMarkRewardProcessed.run(sessionId);
}

async function triggerN8n(
  sessionId: string,
  deviceId: string,
  logs: string[]
): Promise<void> {
  if (stmtCheckN8n.get(sessionId)) {
    logs.push(`N8N_DUPLICATE_SKIPPED [${sessionId}]`);
    return;
  }
  const student = stmtGetStudent.get() as StudentState;
  const webhookUrl = process.env.N8N_WEBHOOK_URL;
  if (webhookUrl) {
    try {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          streak: student.streak,
          coins: student.coins,
          deviceId,
        }),
      });
    } catch {
      // fire-and-forget; log but don't fail the request
    }
  }
  stmtInsertN8n.run(sessionId, Date.now());
  logs.push(`N8N_NOTIFICATION_SENT [${sessionId}]`);
}

/* ── POST /events ────────────────────────────────────────────────── */

router.post("/events", async (req: Request, res: Response) => {
  const events: SyncEvent[] = req.body;
  if (!Array.isArray(events)) {
    res.status(400).json({ error: "body must be SyncEvent[]" });
    return;
  }

  let processed = 0;
  let skipped = 0;
  const logs: string[] = [];
  const n8nQueue: Array<{ sessionId: string; deviceId: string }> = [];

  const ingestTxn = db.transaction(() => {
    for (const evt of events) {
      if (stmtCheckProcessed.get(evt.eventId)) {
        logs.push(`DUPLICATE_IGNORED [${evt.eventId}]`);
        skipped++;
        continue;
      }

      switch (evt.type) {
        case EventType.TASK_STATUS_CHANGED: {
          const existing = stmtGetTask.get(evt.entityId) as
            | { version: number; updatedByDevice: string }
            | undefined;
          const newStatus = evt.payload.status as string;
          const newVersion = evt.version;
          const newDevice = evt.deviceId;
          if (existing) {
            if (
              newVersion > existing.version ||
              (newVersion === existing.version &&
                newDevice > existing.updatedByDevice)
            ) {
              stmtUpsertTask.run(
                evt.entityId,
                (evt.payload.chapterId as string) || "",
                (evt.payload.subjectId as string) || "",
                (evt.payload.title as string) || "",
                newStatus,
                newVersion,
                newDevice
              );
              logs.push(
                `CONFLICT_RESOLVED entity=[${evt.entityId}] winner=[${newDevice}] version=[${newVersion}]`
              );
            } else {
              logs.push(
                `CONFLICT_RESOLVED entity=[${evt.entityId}] winner=[${existing.updatedByDevice}] version=[${existing.version}]`
              );
            }
          } else {
            stmtUpsertTask.run(
              evt.entityId,
              (evt.payload.chapterId as string) || "",
              (evt.payload.subjectId as string) || "",
              (evt.payload.title as string) || "",
              newStatus,
              newVersion,
              newDevice
            );
          }
          break;
        }

        case EventType.SESSION_STARTED: {
          const p = evt.payload;
          stmtUpsertSession.run(
            evt.entityId,
            evt.deviceId,
            (p.targetDuration as number) || 0,
            "ACTIVE",
            (p.startedAt as number) || Date.now(),
            null,
            0,
            null
          );
          break;
        }

        case EventType.SESSION_COMPLETED: {
          const p = evt.payload;
          stmtUpsertSession.run(
            evt.entityId,
            evt.deviceId,
            (p.targetDuration as number) || 0,
            "COMPLETED",
            (p.startedAt as number) || 0,
            (p.completedAt as number) || Date.now(),
            0,
            null
          );
          processReward(
            evt.entityId,
            (p.targetDuration as number) || 0,
            logs
          );
          n8nQueue.push({ sessionId: evt.entityId, deviceId: evt.deviceId });
          break;
        }

        case EventType.SESSION_FAILED: {
          const p = evt.payload;
          stmtUpsertSession.run(
            evt.entityId,
            evt.deviceId,
            (p.targetDuration as number) || 0,
            "FAILED",
            (p.startedAt as number) || 0,
            null,
            0,
            (p.failReason as string) || null
          );
          break;
        }
      }

      // persist event for pull replay + mark processed
      stmtInsertEvent.run(
        evt.eventId,
        evt.entityId,
        evt.deviceId,
        evt.type,
        evt.version,
        JSON.stringify(evt.payload),
        evt.createdAt
      );
      stmtInsertProcessed.run(evt.eventId, Date.now());
      logs.push(`EVENT_SYNCED [${evt.eventId}]`);
      processed++;
    }
  });

  ingestTxn();

  // fire-and-forget n8n triggers (outside transaction)
  for (const { sessionId, deviceId } of n8nQueue) {
    triggerN8n(sessionId, deviceId, logs).catch(() => {});
  }

  const result: IngestResult = { processed, skipped, logs };
  res.json(result);
});

/* ── GET /sync ───────────────────────────────────────────────────── */

router.get("/sync", (req: Request, res: Response) => {
  const since = Number(req.query.since ?? 0);
  const deviceId = (req.query.deviceId as string) || "";

  const rows = stmtEventsSince.all(since, deviceId) as Array<{
    serverSeq: number;
    eventId: string;
    entityId: string;
    deviceId: string;
    type: string;
    version: number;
    payload: string;
    createdAt: number;
  }>;

  const events: SyncEvent[] = rows.map((r) => ({
    eventId: r.eventId,
    entityId: r.entityId,
    deviceId: r.deviceId,
    type: r.type as EventType,
    version: r.version,
    payload: JSON.parse(r.payload),
    createdAt: r.createdAt,
  }));

  const student = stmtGetStudent.get() as StudentState;
  const maxSeq = rows.length > 0 ? rows[rows.length - 1].serverSeq : since;

  const result: SyncPullResult = { events, student, maxSeq };
  res.json(result);
});

/* ── POST /n8n-trigger (manual testing helper) ───────────────────── */

router.post("/n8n-trigger", async (req: Request, res: Response) => {
  const { sessionId, deviceId } = req.body;
  if (!sessionId) {
    res.status(400).json({ error: "sessionId required" });
    return;
  }
  const logs: string[] = [];
  await triggerN8n(sessionId, deviceId || "unknown", logs);
  res.json({ logs });
});

/* ── GET /state (debug) ──────────────────────────────────────────── */

router.get("/state", (_req: Request, res: Response) => {
  const student = stmtGetStudent.get();
  const tasks = db.prepare("SELECT * FROM tasks").all();
  const sessions = db.prepare("SELECT * FROM sessions").all();
  const pendingN8n = db.prepare("SELECT * FROM n8n_sent").all();
  res.json({ student, tasks, sessions, pendingN8n });
});

/* ── DELETE /reset (debug) ───────────────────────────────────────── */

router.delete("/reset", (_req: Request, res: Response) => {
  db.exec(`
    DELETE FROM processed_events;
    DELETE FROM events;
    DELETE FROM tasks;
    DELETE FROM sessions;
    DELETE FROM n8n_sent;
    UPDATE student SET streak=0, coins=0, focusMinutesToday=0 WHERE id='singleton';
  `);
  res.json({ ok: true });
});

export default router;
