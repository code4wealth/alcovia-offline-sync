# Alcovia — Offline-First Study Sync

An offline-first study productivity application demonstrating custom event-driven synchronization, deterministic conflict resolution, exactly-once reward processing, and n8n automation — all built from scratch without Firebase Sync, Replicache, PowerSync, or Yjs.

## Architecture Overview

```
Frontend (Expo Web, per device)          Backend (Express + SQLite)
┌──────────────────────────┐         ┌─────────────────────────────┐
│ Local State (AsyncStorage)│  ←───  │ GET /sync (event replay)     │
│ Event Queue (durable)     │  ───→  │ POST /events (idempotent)    │
│ Sync Engine               │         │ processed_events table       │
│ LWW Conflict Resolution   │         │ Reward processor (exactly-1) │
│ Online/Offline Toggle     │         │ n8n webhook trigger          │
└──────────────────────────┘         └──────────────┬──────────────┘
                                                     │
                                           ┌─────────▼──────────┐
                                           │ n8n Workflow        │
                                           │ Static Data dedup   │
                                           │ → Notification sink │
                                           └────────────────────┘
```

## Setup

### Prerequisites
- Node.js >= 18
- npm >= 9

### Backend
```bash
cd backend
npm install
```

### Frontend
```bash
cd frontend
npm install
```

### n8n (optional)
1. Install n8n: `npm install -g n8n`
2. Start n8n: `n8n start`
3. Import `n8n-workflow.json` via the n8n UI
4. Activate the workflow
5. Copy the webhook URL and set it as `N8N_WEBHOOK_URL` when starting the backend

## Running

Terminal 1 — Backend:
```bash
cd backend
npm run dev
# Backend runs on http://localhost:3001
# Optional: N8N_WEBHOOK_URL=http://localhost:5678/webhook/alcovia-session npm run dev
```

Terminal 2 — Frontend:
```bash
cd frontend
npx expo start --web
# Opens on http://localhost:8081
```

### Multi-Device Simulation
Open two browser tabs (or one regular + one incognito window). Each tab gets a unique `deviceId` persisted in localStorage, simulating two separate devices on the same student account.

## Test Scenarios

### Scenario A — Basic Offline Sync
1. Open the app in one browser tab (Device 1)
2. Go to **Dev** tab → click **ONLINE** badge to toggle to **OFFLINE**
3. Go to **Focus** tab → select 25m → click **Start Session**
4. Wait for timer or for demo purposes, the session mechanics work; for quick test, go to **Syllabus** and change a task status
5. Go to **Dev** tab → toggle back to **ONLINE**
6. Click **Manual Sync**
7. **Verify**: Sync log shows `EVENT_SYNCED [eventId]`. Coins/streak incremented exactly once. If n8n is configured, `N8N_NOTIFICATION_SENT` appears.

### Scenario B — Conflicting Task Edits
1. Open two tabs (Device 1 and Device 2)
2. Both devices: **Dev** tab → toggle **OFFLINE**
3. Device 1: **Syllabus** → tap "Linear Equations" once → status becomes `IN_PROGRESS` (v1)
4. Device 2: **Syllabus** → tap "Linear Equations" twice → status becomes `DONE` (v2, since it increments from v0→v1→v2, but if both start from v0, Device 2 taps twice: NOT_STARTED→IN_PROGRESS(v1)→DONE(v2))
5. Device 1: toggle **ONLINE**, click **Manual Sync**
6. Device 2: toggle **ONLINE**, click **Manual Sync**
7. Device 1: click **Manual Sync** again (to pull Device 2's updates)
8. **Verify**: Both devices show the same final status. Dev panel shows `CONFLICT_RESOLVED entity=[task-linear-eq] winner=[deviceX] version=[N]`. Higher version wins; equal version → higher deviceId (lexicographic) wins.

### Scenario C — Duplicate Sync (Idempotency Stress)
1. Open one tab, complete a focus session (or change a task)
2. Go to **Dev** tab → click **Replay x3 (Idempotency)**
3. **Verify**: Coins incremented only once. Sync log shows `DUPLICATE_IGNORED [eventId]` for repeated submissions. `REWARD_ALREADY_PROCESSED [sessionId]` appears if a completed session is re-submitted.

### Scenario D — Simultaneous Offline Sessions
1. Open two tabs (Device 1 and Device 2)
2. Both: **Dev** → toggle **OFFLINE**
3. Device 1: **Focus** → start and complete a 25m session
4. Device 2: **Focus** → start and complete a 25m session
5. Device 1: toggle **ONLINE**, **Manual Sync**
6. Device 2: toggle **ONLINE**, **Manual Sync**
7. Device 1: **Manual Sync** again
8. **Verify**: Total coins = 100, streak = 2, focus minutes = 50. Each session rewarded exactly once. No duplicate rewards.

## n8n Dedup Proof

When the n8n workflow is active:
1. The `Dedup Check` Code node uses `$getWorkflowStaticData('global')` to persist processed sessionIds
2. First trigger for a sessionId → passes through to `Send Notification`
3. Second trigger for the same sessionId → routes to `Log Duplicate` which outputs `{ status: "DUPLICATE_SKIPPED", sessionId: "..." }`
4. View this in n8n's **Execution History** → click on the duplicate execution → the `Log Duplicate` node shows the skipped output

Additionally, the backend has its own `n8n_sent` table that prevents the webhook from firing twice for the same sessionId, providing double protection.

## Known Limitations

1. **Single student account**: No multi-user authentication. The backend stores a single `student` row.
2. **Streak logic is cumulative**: Streak increments by 1 per completed session rather than tracking calendar days. A day-based streak would require date math and timezone handling.
3. **focusMinutesToday is cumulative**: Not reset daily. Would need a cron job or date-based reset.
4. **No persistent focus timer on web**: If the browser tab is closed during a focus session, the timer state is lost (AsyncStorage persists but `setInterval` does not survive tab close). On native React Native, background task APIs could address this.
5. **n8n Static Data is in-memory per worker**: In a clustered n8n deployment, Static Data is not shared across workers. For production, replace with a database lookup.
6. **No authentication/authorization**: Any client can submit events for any device.
7. **SQLite backend**: Not suitable for horizontal scaling. For production, migrate to PostgreSQL.
