import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(__dirname, "..", "alcovia.db");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS processed_events (
    eventId   TEXT PRIMARY KEY,
    processedAt INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    serverSeq   INTEGER PRIMARY KEY AUTOINCREMENT,
    eventId     TEXT UNIQUE NOT NULL,
    entityId    TEXT NOT NULL,
    deviceId    TEXT NOT NULL,
    type        TEXT NOT NULL,
    version     INTEGER NOT NULL,
    payload     TEXT NOT NULL,
    createdAt   INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tasks (
    taskId          TEXT PRIMARY KEY,
    chapterId       TEXT NOT NULL,
    subjectId       TEXT NOT NULL,
    title           TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'NOT_STARTED',
    version         INTEGER NOT NULL DEFAULT 0,
    updatedByDevice TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS sessions (
    sessionId       TEXT PRIMARY KEY,
    deviceId        TEXT NOT NULL,
    targetDuration  INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'ACTIVE',
    startedAt       INTEGER NOT NULL DEFAULT 0,
    completedAt     INTEGER,
    rewardProcessed INTEGER NOT NULL DEFAULT 0,
    failReason      TEXT
  );

  CREATE TABLE IF NOT EXISTS student (
    id              TEXT PRIMARY KEY DEFAULT 'singleton',
    streak          INTEGER NOT NULL DEFAULT 0,
    coins           INTEGER NOT NULL DEFAULT 0,
    focusMinutesToday INTEGER NOT NULL DEFAULT 0
  );

  INSERT OR IGNORE INTO student (id) VALUES ('singleton');

  CREATE TABLE IF NOT EXISTS n8n_sent (
    sessionId TEXT PRIMARY KEY,
    sentAt    INTEGER NOT NULL
  );
`);

export default db;
