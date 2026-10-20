# Cloudflare usage reduction (fork-only)

Fork-only plan. These changes are never proposed upstream. Each one has to cut Cloudflare usage,
move us toward free-plan limits, and leave the user experience no worse. Every change is logged in
[`docs/fork-patches.md`](../fork-patches.md) so upstream syncs can find it.

## Baseline (Cloudflare analytics, 2026-10-16, a normal heavy day)

| Resource                | Free limit      | Used                                              |
| ----------------------- | --------------- | ------------------------------------------------- |
| Worker CPU / invocation | 10 ms           | control-plane p50 9.8 ms, p99 189 ms              |
| DO SQLite rows written  | 100k/day        | 233k, all from `SessionDO`                        |
| DO duration             | 13,000 GB-s/day | ~11,900 GB-s                                      |
| D1 rows read            | 5M/day          | 2.57M (inbox query ~65%, finalization sweep ~13%) |
| DO requests             | 100k/day        | 58.8k                                             |
| D1 rows written         | 100k/day        | 37k                                               |
| KV reads / writes       | 100k / 1k       | 4.0k / 217                                        |

The free plan's 10 ms CPU cap is out of reach, so we stay on the paid plan. The goal is to stay
inside the paid plan's included usage, and the two metrics nearest a limit are DO rows written and
DO duration.

## Done

1. **Release the client auth timer early.** `enforceAuthTimeout` used to sleep the full
   `WS_AUTH_TIMEOUT_MS` on every client connection, even after the client authenticated, and the
   pending timer kept the session DO awake. The manager now settles the timer once the client
   activates or is torn down (`packages/control-plane/src/session/websocket-manager.ts`).
2. **Per-statement DO SQLite usage.** `packages/control-plane/src/cloudflare/sql-usage-meter.ts`
   wraps the session DO's `SqlStorage` and logs `do.sql_usage` events, at most one per minute per
   activation, with the top statements by rows written. Use these events to rank write sources
   before starting items 3 and 4.
3. **Expired webhook dedupe cleanup.**
   `packages/control-plane/src/db/github-webhook-delivery-cleanup.ts` runs in the hourly
   `session_auto_archive` job (`packages/control-plane/src/scheduled-jobs.ts`) and deletes expired
   `github_webhook_deliveries` rows in bounded, rowid-ordered batches, without an `expires_at`
   index.

## Planned

### A. Coalesce token events in the sandbox bridge

Done (CHE-1052). The coalescer sits in `AgentBridge._send_event`, the one path every turn event
takes, rather than inside `BufferedEventForwarder`, so the forwarder's delivery state machine is
unchanged. Runtime generation 77.

- **Problem:** each streamed token event triggers an upsert in the session DO
  (`packages/control-plane/src/session/sandbox-events/streaming.handler.ts`, `upsertTokenEvent` in
  `packages/control-plane/src/session/event-repository.ts`). Claude sends one event per text delta
  (`include_partial_messages` in `packages/sandbox-runtime/src/sandbox_runtime/harness/claude.py`).
  OpenCode is unthrottled. Codex throttles at 100 ms (`TEXT_UPDATE_INTERVAL_SECONDS` in
  `harness/codex/events.py`).
- **Change:** coalesce `token` events per message and part in one fork module used by
  `packages/sandbox-runtime/src/sandbox_runtime/event_forwarder.py`, with a 200 ms interval in a
  single named constant. Token content is cumulative, so only the latest frame per key needs
  sending.
  - Flush the pending frame before forwarding any non-token event, and at turn end, so ordering and
    completion are preserved.
  - Don't buffer in the DO. If the DO buffered text it had already broadcast and was then evicted,
    that text would be lost.
- **Acceptance:**
  - Streaming still renders smoothly, at about 5 updates/s.
  - Every final message text is persisted intact.
  - `do.sql_usage` shows the token upsert's rows written falling several-fold.
- **Ships with** a sandbox image rebuild.

### B. Remove no-op DO writes

Done (CHE-1053). Activity renewals use `LAST_ACTIVITY_WRITE_INTERVAL_MS` in
`packages/control-plane/src/sandbox/lifecycle/decisions.ts`; the checkpoint-release write still
restarts the clock unconditionally.

- **Throttle last activity:** guard `updateSandboxLastActivity`
  (`packages/control-plane/src/session/sandbox-repository.ts`) so it skips the write when the stored
  value is under 15 s old.
  - This is safe because the inactivity timeout is minutes long
    (`packages/control-plane/src/sandbox/lifecycle/decisions.ts`).
- **Drop unchanged columns:** remove `message_id = excluded.message_id` from the token and tool-call
  upserts, and the no-op `created_at = events.created_at` on the partId path
  (`packages/control-plane/src/session/event-repository.ts`). The row id already encodes the message
  id.
- **Acceptance:**
  - `do.sql_usage` shows lower rows written for these statements.
  - The inactivity timeout and event history behave the same.

### C. Run the automation finalization sweep every 15 minutes

Done (CHE-1054). The tick receives its cron slot time (`event.scheduledTime` on Cloudflare) and runs
the sweep only on 15-minute slots; `countInvocationFailure` in
`packages/control-plane/src/db/automation-store.ts` writes the mark and the strike in one batch.

- **Today:** `finalizationSweep` (`packages/control-plane/src/scheduler/scheduler.ts`) runs on every
  one-minute tick. Its `getUncountedFailedInvocations` query
  (`packages/control-plane/src/db/automation-store.ts`) reads ~183 rows per call, which is ~13% of
  D1 reads.
- **Why it can be slower:** the sweep only repairs accounting missed in a crash window. Normal
  callbacks already account inline.
- **Change:** run only the finalization sweep every 15 minutes, matching the minimum automation
  schedule interval. Leave the rest of the tick on its one-minute cadence.
- **Also fix:** make failure accounting atomic. Today `tryMarkInvocationFailureCounted` and
  `incrementConsecutiveFailures` are separate statements, so a crash between them loses a strike.
  Run both in one D1 `batch()`.
- **Acceptance:** the sweep query's daily rows read drop about 15×, and the auto-pause behaviour
  tests still pass.

### D. Stuck sessions, then the inbox scan

- **Part 1, done (CHE-1055).** A sandbox launch whose provider create failed (or that the circuit
  breaker refused) left its prompt `pending` forever. The session stayed `active`, archive refused
  it for queued work, Cancel left it `cancelled`, which archive also refused, and auto-archive never
  selected it. Five such sessions were repaired by hand on 2026-10-20; each had a `failed` sandbox
  with no provider object or heartbeat, one never-started `pending` message, and no events.
  - A launch that leaves nothing able to connect (`launchFailure()` in
    `packages/control-plane/src/sandbox/lifecycle/manager.ts`) arms the DO alarm 30 s out, and the
    alarm fails the waiting prompt with the launch's reason, as it already does for a connect
    timeout. A launch started in between keeps the prompt. Sessions already stuck are repaired the
    next time their alarm fires.
  - Cancelled sessions can be archived, and unarchive restores them as `cancelled`.
  - A dead sandbox does not re-arm the alarm (`evaluateAlarmPolicy` returns `terminal` first), so no
    alarm change was needed.
- **Part 2, measure (trusted operator, after Part 1 deploys).** Count unarchived sessions by
  `status` and `spawn_source`, find any left in the stuck state, and check the auto-archive sweep's
  `truncated` log for a backlog against its cap of 40 per hour. Record the results here.
- **Part 3, extend auto-archive only if Part 2 shows a need.** Raise the cap for a backlog, or
  extend the age rules to whatever terminal sessions dominate. Never auto-archive `created` or
  `active` sessions, and keep the unread and active-lineage protections
  (`packages/control-plane/src/db/session-auto-archive-store.ts`).
- **Why it matters:** the inbox query (`packages/control-plane/src/db/session-inbox-store.ts`) reads
  the viewer's whole unarchived set, ~900 rows per call.

## Rejected

- **Buffering tokens in the DO:** loses text that was already broadcast if the DO is evicted.
- **Dropping `events` indexes:** all three are used.
- **An `expires_at` index for webhook cleanup:** adds writes to every webhook.
- **A slower idle heartbeat:** the 90 s staleness check assumes 30 s heartbeats.
- **A KV inbox cache:** KV's write limit is too low for it.
- **Running the whole sweep every 30 minutes:** delays auto-pause too long.
