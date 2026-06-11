# DECISIONS.md — Alcovia Architecture & Design Decisions

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (Expo Web)                       │
│                                                                   │
│  ┌─────────┐  ┌──────────┐  ┌────────────┐  ┌───────────────┐  │
│  │ Focus   │  │ Syllabus │  │ Dev Panel  │  │ Sync Engine   │  │
│  │ Screen  │  │ Screen   │  │            │  │               │  │
│  └────┬────┘  └────┬─────┘  └─────┬──────┘  └───┬───────────┘  │
│       │            │              │              │               │
│  ┌────▼────────────▼──────────────▼──────────────▼───────────┐  │
│  │              Local Storage (AsyncStorage/localStorage)     │  │
│  │  ┌──────────┐ ┌──────────┐ ┌────────────┐ ┌───────────┐  │  │
│  │  │ tasks{}  │ │sessions{}│ │pendingEvts[]│ │streak/coins│  │  │
│  │  └──────────┘ └──────────┘ └────────────┘ └───────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
└──────────────────────────────┼───────────────────────────────────┘
                               │ HTTP (JSON)
                    ┌──────────▼──────────┐
                    │  POST /events       │
                    │  GET  /sync         │
                    ├─────────────────────┤
                    │  Express Backend    │
                    │  ┌───────────────┐  │
                    │  │ SQLite        │  │
                    │  │ ┌───────────┐ │  │
                    │  │ │processed_ │ │  │
                    │  │ │events     │ │  │
                    │  │ ├───────────┤ │  │
                    │  │ │events     │ │  │
                    │  │ │(log+replay│ │  │
                    │  │ ├───────────┤ │  │
                    │  │ │tasks      │ │  │
                    │  │ ├───────────┤ │  │
                    │  │ │sessions   │ │  │
                    │  │ ├───────────┤ │  │
                    │  │ │student    │ │  │
                    │  │ ├───────────┤ │  │
                    │  │ │n8n_sent   │ │  │
                    │  │ └───────────┘ │  │
                    │  └───────────────┘  │
                    └─────────┬───────────┘
                              │ POST (fire-and-forget)
                    ┌─────────▼───────────┐
                    │  n8n Workflow        │
                    │  ┌───────────────┐  │
                    │  │Webhook trigger│  │
                    │  ├───────────────┤  │
                    │  │Dedup (Static  │  │
                    │  │Data by sessId)│  │
                    │  ├───────────────┤  │
                    │  │IF skip=false  │  │
                    │  ├──────┬────────┤  │
                    │  │Send  │ Log    │  │
                    │  │Notif │ Dup    │  │
                    │  └──────┴────────┘  │
                    └─────────────────────┘
```

## Sync Model

### Why event-based, not snapshot-based

We sync **individual operations** (events), not full state snapshots:

1. **Bandwidth efficiency**: Only changes are transmitted, not the entire state.
2. **Conflict detection**: Individual operations carry entity-scoped version numbers, enabling precise per-field conflict resolution. Snapshot sync would require diffing entire states.
3. **Idempotency**: Each event has a stable `eventId` (UUID). The backend's `processed_events` table provides O(1) duplicate detection. Replaying the same event is a no-op.
4. **Auditability**: The server-side `events` table is an append-only log. Any state can be reconstructed by replaying events in order.

### Event structure

```typescript
interface SyncEvent {
  eventId: string;    // UUID, never regenerated — idempotency key
  entityId: string;   // task or session being modified
  deviceId: string;   // stable per-device identifier
  type: EventType;    // discriminator for handler dispatch
  version: number;    // logical clock, per-entity, monotonic, never wall-clock
  payload: object;    // operation data
  createdAt: number;  // display timestamp only — NEVER used for merge
}
```

The `version` field is the core of the consistency model. It is:
- **Per-entity**: Each task/session has its own version counter
- **Monotonically incrementing**: Incremented on every write (version = prev + 1)
- **Never reset**: Survives across devices and sync cycles
- **Never derived from wall-clock time**: Immune to clock skew between devices

## Convergence Guarantee

**Claim**: Given the same set of events (in any order), all devices arrive at the same final state.

**Proof**:

The merge function for any entity is:

```
merge(existing, incoming) =
  if incoming.version > existing.version → incoming wins
  if incoming.version == existing.version → lexicographically higher deviceId wins
  else → existing wins (incoming is stale)
```

This function is:
1. **Deterministic**: Given the same (version, deviceId) pair, the outcome is always the same
2. **Commutative**: merge(A, B) == merge(B, A) — order of arrival doesn't matter
3. **Idempotent**: merge(A, A) == A — replaying the same event is a no-op

Because the merge function is commutative, applying events A then B produces the same result as B then A. Therefore, regardless of which device syncs first or in what order events arrive, the final state converges.

**Example walkthrough**:
- Device A (deviceId="device-aaaa") sets Task X to IN_PROGRESS, version=1
- Device B (deviceId="device-bbbb") sets Task X to DONE, version=1
- Both sync to backend:
  - If A arrives first: Task X = IN_PROGRESS (v1, device-aaaa). B arrives: v1==v1, "device-bbbb" > "device-aaaa" → B wins → Task X = DONE
  - If B arrives first: Task X = DONE (v1, device-bbbb). A arrives: v1==v1, "device-aaaa" < "device-bbbb" → B still wins → Task X = DONE
- **Same result regardless of order.**

## Conflict Resolution

Strategy: **Last-Writer-Wins (LWW) with logical version + lexicographic deviceId tiebreak.**

Rules applied on both backend AND frontend:
1. `incoming.version > existing.version` → incoming wins (higher version is newer)
2. `incoming.version == existing.version` → `incoming.deviceId > existing.updatedByDevice` (lexicographic) → incoming wins
3. Otherwise → existing wins

This is applied in:
- `backend/src/routes.ts` — TASK_STATUS_CHANGED handler
- `frontend/src/storage/localMutations.ts` — `applyTaskUpdate()`

Wall-clock timestamps (`createdAt`) are stored for display but **never** consulted during merge.

## Backend Idempotency

### Event-level dedup: `processed_events` table

```sql
CREATE TABLE processed_events (
  eventId TEXT PRIMARY KEY,
  processedAt INTEGER NOT NULL
);
```

Before processing any event, the handler checks:
```
if (processed_events.has(eventId)) → skip, return success, log DUPLICATE_IGNORED
```

This makes the entire POST /events endpoint safe to retry. Submitting the same event 100 times has the same effect as submitting it once.

### Reward-level dedup: `sessions.rewardProcessed` column

Even if two different eventIds refer to the same session completion (e.g., from two devices), reward processing checks:
```
if (sessions[sessionId].rewardProcessed == 1) → skip, log REWARD_ALREADY_PROCESSED
```

The reward block (coins += 50, streak += 1, focusMinutes += duration, rewardProcessed = 1) executes inside a SQLite transaction, preventing race conditions.

### Double protection

| Layer | Key | Protects Against |
|-------|-----|-----------------|
| `processed_events` | `eventId` | Same event replayed (network retry, duplicate push) |
| `sessions.rewardProcessed` | `sessionId` | Same session reported by multiple devices/events |
| `n8n_sent` | `sessionId` | Webhook fired twice for same session |

## n8n Idempotency

The n8n workflow uses **Static Data** (`$getWorkflowStaticData('global')`) as an in-memory key-value store:

```javascript
const store = $getWorkflowStaticData('global');
const id = $json.sessionId;
if (store[id]) {
  return [{ json: { skip: true, sessionId: id, reason: 'DUPLICATE_SKIPPED' } }];
}
store[id] = Date.now();
return [{ json: { skip: false, ...inputData } }];
```

- First call for sessionId → stored, passes to notification node
- Subsequent calls → `skip: true` → routed to "Log Duplicate" node
- Static Data persists across executions within the same n8n worker process

Combined with the backend's `n8n_sent` table (which prevents the webhook from even firing twice), this provides defense-in-depth.

## Tradeoff Table

| Alternative Considered | Chosen Approach | Reason |
|----------------------|-----------------|--------|
| Snapshot-based sync (send full state) | Event-based sync (send operations) | Events enable per-entity conflict resolution, are bandwidth-efficient, and naturally support idempotency via eventId dedup. Snapshots would require expensive diffs and can't resolve concurrent edits deterministically. |
| Wall-clock timestamps for merge | Logical version (monotonic integer per entity) | Wall clocks drift between devices. Two devices offline for hours may have arbitrary clock skew. Logical versions are immune to this — they only depend on the sequence of writes, not real time. |
| CRDTs (e.g., G-Counter for streak) | LWW with canonical backend state | CRDTs add significant complexity. Since we have a single backend (not peer-to-peer), the backend's student row is the canonical source of truth. Clients adopt it on sync. Simpler, easier to reason about, sufficient for the single-backend topology. |
| Firebase/Replicache/PowerSync | Custom sync engine | Assignment explicitly prohibits these. Beyond that, building from scratch demonstrates understanding of the underlying distributed systems principles. |
| Timestamp-based event ordering for pull cursor | Server-assigned monotonic sequence number (`serverSeq`) | Timestamps can collide (two events in the same millisecond) or go backwards (clock adjustment). A server-assigned sequence number is strictly monotonic and never ambiguous. |
| Separate notification service | n8n with Static Data dedup | n8n is a visual workflow tool that makes the notification pipeline inspectable and auditable. Static Data provides simple idempotency without requiring an external database for the workflow. |
| Client-side reward computation (each device computes own totals) | Backend canonical + client optimistic | If each device computed independently, two devices completing different sessions offline would each think streak=1. After sync, reconciling to streak=2 requires CRDTs or complex merge. Instead, the backend computes the true total, and clients adopt it on sync. Offline optimistic updates provide instant UI feedback. |

## Remaining Risks

1. **Single-point-of-failure backend**: If the Express server goes down, sync fails. Both devices continue working offline, but convergence is delayed until the server recovers.

2. **n8n Static Data volatility**: Static Data is in-memory per n8n worker. If n8n restarts, the dedup state is lost, and the next trigger for an already-processed sessionId would send a duplicate notification. Mitigation: the backend's `n8n_sent` table prevents the webhook from firing at all in this case.

3. **No authentication**: Any HTTP client can submit events. In production, JWT-based auth would scope events to authenticated users.

4. **Clock skew for `createdAt`**: While `createdAt` is never used for merge logic, it's used for display ordering in the dev panel. Extreme clock skew could make log display confusing (but never affects correctness).

5. **Large event queues**: If a device stays offline for weeks, the pending event queue could grow large. A production system would need pagination on push and bounded queue sizes.

6. **No garbage collection**: The `events` and `processed_events` tables grow indefinitely. In production, events older than a retention window should be pruned.

7. **focusMinutesToday never resets**: The "today" counter is cumulative. A real implementation would reset at midnight in the user's timezone.
