import { describe, expect, it, vi } from "vitest";
import type { Logger } from "../logger";
import type { SessionRuntimeClient } from "./runtime-client";
import { SessionInternalPaths } from "./contracts";
import { SessionAutoArchiveSweep } from "./auto-archive-sweep";

describe("SessionAutoArchiveSweep", () => {
  it("bounds the backlog and isolates runtime failures from successful archives", async () => {
    const index = { listCandidates: vi.fn(async () => ["read", "changed", "broken"]) };
    const fetch = vi.fn<SessionRuntimeClient["fetch"]>(async (id) => {
      if (id === "broken") return new Response("unavailable", { status: 503 });
      return Response.json({ outcome: id === "read" ? "archived" : "ineligible" });
    });
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
    const result = await new SessionAutoArchiveSweep(index, { fetch }, log).run(123);
    expect(index.listCandidates).toHaveBeenCalledWith(123, 40);
    expect(
      fetch.mock.calls.every(
        ([, path, init]) => path === SessionInternalPaths.autoArchive && init?.method === "POST"
      )
    ).toBe(true);
    expect(result).toEqual({
      candidates: 3,
      archived: 1,
      skipped: 1,
      errored: 1,
      truncated: false,
    });
  });

  it("does not contact runtimes when no old read sessions qualify", async () => {
    const index = { listCandidates: vi.fn(async () => []) };
    const fetch = vi.fn<SessionRuntimeClient["fetch"]>();
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
    expect(await new SessionAutoArchiveSweep(index, { fetch }, log).run(123)).toEqual({
      candidates: 0,
      archived: 0,
      skipped: 0,
      errored: 0,
      truncated: false,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects unexpected runtime outcomes instead of counting them as archives", async () => {
    const index = { listCandidates: vi.fn(async () => ["protocol-drift"]) };
    const fetch = vi.fn<SessionRuntimeClient["fetch"]>(async () =>
      Response.json({ outcome: "unknown" })
    );
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
    expect((await new SessionAutoArchiveSweep(index, { fetch }, log).run(123)).errored).toBe(1);
  });
});
