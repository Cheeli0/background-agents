# Fork patches

Fork-only changes to upstream-owned behaviour. During an upstream sync, check each entry: drop it if
upstream fixed the same thing, and re-verify it if upstream touched the listed files.

| Patch                                  | Files                                                                                                                        | Why                                                                                           |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| GitHub webhook dedupe in D1            | `packages/github-bot/src/delivery-dedupe.ts`, `terraform/d1/migrations/0080_github_webhook_deliveries.sql`                   | KV writes per webhook exceeded the free plan's 1k/day limit.                                  |
| Expired webhook dedupe cleanup         | `packages/control-plane/src/db/github-webhook-delivery-cleanup.ts`, `packages/control-plane/src/scheduled-jobs.ts`           | Nothing else deletes expired dedupe rows.                                                     |
| Session auto-archive                   | `packages/control-plane/src/session/auto-archive-*.ts`, `packages/control-plane/src/db/session-auto-archive-store.ts`        | Keeps the inbox scan small.                                                                   |
| Early release of the client auth timer | `packages/control-plane/src/session/websocket-manager.ts`                                                                    | The 30 s timer kept the session DO awake after every authenticated connection.                |
| Per-statement DO SQLite usage logging  | `packages/control-plane/src/cloudflare/sql-usage-meter.ts`, `cloudflare/durable-object.ts`, `cloudflare/session-platform.ts` | Ranks DO write sources; Cloudflare only reports per-namespace totals.                         |
| Memory write guidance in boot context  | `packages/control-plane/src/memory/write-guidance.ts`, `packages/control-plane/src/memory/session-memory-service.ts`         | Upstream renders nothing for an empty memory store, so agents never started writing memories. |

The plan these belong to is
[`docs/plans/cloudflare-usage-reduction.md`](plans/cloudflare-usage-reduction.md).
