import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { generateEncryptionKey } from "../auth/crypto";
import { createLogger } from "../logger";
import { createNodeSqlStorage } from "../node/sqlite-storage";
import { SandboxBootstrapHandler } from "./http/handlers/sandbox-bootstrap.handler";
import { SandboxBootstrapRepository } from "./sandbox-bootstrap-repository";
import { SandboxRepository } from "./sandbox-repository";
import { initSchema } from "./schema";

const KEY = generateEncryptionKey();
const log = createLogger("sandbox-bootstrap-test", {}, "error");
const ENV = { SANDBOX_AUTH_TOKEN: "sandbox-secret", MY_SECRET: "repo-secret" };

function createStores() {
  const db = new DatabaseSync(":memory:");
  const { sql } = createNodeSqlStorage(db);
  initSchema(sql);
  const sandboxes = new SandboxRepository(sql, log, KEY);
  sandboxes.createSandbox({
    id: "row-1",
    status: "spawning",
    gitSyncStatus: "pending",
    createdAt: 1000,
  });
  sql.exec("UPDATE sandbox SET modal_sandbox_id = 'sb-1'");
  const setSandbox = (assignments: string) => sql.exec(`UPDATE sandbox SET ${assignments}`);
  return { db, sql, store: new SandboxBootstrapRepository(sql, KEY), sandboxes, setSandbox };
}

describe("SandboxBootstrapRepository", () => {
  it("returns the environment once, then never again", async () => {
    const { store } = createStores();
    await store.put({ sandboxId: "sb-1", env: ENV }, "token-1", 5000);

    expect(await store.consume("token-1", 4000)).toEqual({ sandboxId: "sb-1", env: ENV });
    expect(await store.consume("token-1", 4000)).toBeNull();
  });

  it("refuses an expired token and removes it", async () => {
    const { store, db } = createStores();
    await store.put({ sandboxId: "sb-1", env: ENV }, "token-1", 5000);

    expect(await store.consume("token-1", 5000)).toBeNull();
    expect(db.prepare("SELECT COUNT(*) AS n FROM sandbox_bootstrap").get()).toEqual({ n: 0 });
  });

  it("replaces an earlier bootstrap, so a superseded launch cannot redeem", async () => {
    const { store } = createStores();
    await store.put({ sandboxId: "sb-1", env: ENV }, "token-1", 5000);
    await store.put({ sandboxId: "sb-2", env: { A: "b" } }, "token-2", 5000);

    expect(await store.consume("token-1", 1000)).toBeNull();
    expect(await store.consume("token-2", 1000)).toEqual({ sandboxId: "sb-2", env: { A: "b" } });
  });

  it("stores neither the token nor the environment in the clear", async () => {
    const { store, db } = createStores();
    await store.put({ sandboxId: "sb-1", env: ENV }, "token-1", 5000);

    const stored = JSON.stringify(db.prepare("SELECT * FROM sandbox_bootstrap").all());
    expect(stored).not.toContain("token-1");
    expect(stored).not.toContain("sandbox-secret");
    expect(stored).not.toContain("repo-secret");
  });
});

describe("SandboxBootstrapHandler", () => {
  function redeem(handler: SandboxBootstrapHandler, token?: string) {
    return handler.redeem(
      new Request("http://internal/internal/sandbox-bootstrap", {
        method: "POST",
        headers: token === undefined ? {} : { Authorization: `Bearer ${token}` },
      }),
      log
    );
  }

  it("hands the current generation its environment", async () => {
    const { store, sandboxes } = createStores();
    await store.put({ sandboxId: "sb-1", env: ENV }, "token-1", Date.now() + 60_000);
    const handler = new SandboxBootstrapHandler(store, sandboxes);

    const response = await redeem(handler, "token-1");

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ sandboxId: "sb-1", env: ENV });
    expect((await redeem(handler, "token-1")).status).toBe(401);
  });

  it("refuses a missing or unknown token", async () => {
    const { store, sandboxes } = createStores();
    const handler = new SandboxBootstrapHandler(store, sandboxes);

    expect((await redeem(handler)).status).toBe(401);
    expect((await redeem(handler, "nope")).status).toBe(401);
  });

  it.each([
    ["a newer generation", "modal_sandbox_id = 'sb-2'"],
    ["a stopped sandbox", "status = 'stopped'"],
    ["a fenced generation", "fenced = 1"],
    ["a fenced generation whose startup failed", "fenced = 1, status = 'failed'"],
  ])("refuses a bootstrap that no longer belongs to %s", async (_name, assignments) => {
    const { store, sandboxes, setSandbox } = createStores();
    await store.put({ sandboxId: "sb-1", env: ENV }, "token-1", Date.now() + 60_000);
    setSandbox(assignments);

    const response = await redeem(new SandboxBootstrapHandler(store, sandboxes), "token-1");

    expect(response.status).toBe(401);
  });
});
