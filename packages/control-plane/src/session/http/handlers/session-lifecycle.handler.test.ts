import { describe, expect, it, vi } from "vitest";
import { createMockSession } from "../../../sandbox/lifecycle/test-helpers";
import type { MessageRepository } from "../../message-repository";
import type { SandboxStateReader } from "../../sandbox-ports";
import type { SessionCoreRepository } from "../../session-core-repository";
import type { SessionStatusService } from "../../session-status-service";
import type { SessionTitleService } from "../../title-service";
import { SessionLifecycleHandler } from "./session-lifecycle.handler";

function createHandler() {
  const session = createMockSession({
    status: "completed",
    updated_at: Date.now() - 2 * 24 * 60 * 60 * 1000,
  });
  const autoArchiveEligible = vi.fn(async () => true);
  const getPendingOrProcessingCount = vi.fn(() => 0);
  const beginTransition = vi.fn<SessionStatusService["beginTransition"]>();
  const confirmIndexStatus = vi.fn<SessionStatusService["confirmIndexStatus"]>();
  const preserveForArchive = vi.fn(async () => undefined);
  const repairIndexStatus = vi.fn(async () => undefined);
  const handler = new SessionLifecycleHandler(
    { getSession: () => session } as SessionCoreRepository,
    {} as SandboxStateReader,
    { getPendingOrProcessingCount } as unknown as MessageRepository,
    { beginTransition, confirmIndexStatus, repairIndexStatus } as unknown as SessionStatusService,
    {} as SessionTitleService,
    { cancelSandbox: vi.fn(), preserveForArchive },
    "session-do-id",
    vi.fn(),
    autoArchiveEligible
  );
  return {
    handler,
    beginTransition,
    confirmIndexStatus,
    preserveForArchive,
    session,
    autoArchiveEligible,
    repairIndexStatus,
    getPendingOrProcessingCount,
  };
}

describe("SessionLifecycleHandler.archive", () => {
  it("archives successfully without participant authorization", async () => {
    const { handler, beginTransition, preserveForArchive } = createHandler();
    beginTransition.mockResolvedValue(true);

    const response = await handler.archive();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "archived", outcome: "archived" });
    expect(beginTransition).toHaveBeenCalledWith("archived");
    expect(preserveForArchive).toHaveBeenCalledOnce();
    expect(beginTransition.mock.invocationCallOrder[0]).toBeLessThan(
      preserveForArchive.mock.invocationCallOrder[0]
    );
  });

  it("does not preserve when the synchronous local transition fails", async () => {
    const { handler, beginTransition, preserveForArchive, confirmIndexStatus } = createHandler();
    beginTransition.mockImplementation(() => {
      throw new Error("local status write failed");
    });

    await expect(handler.archive()).rejects.toThrow("local status write failed");

    expect(preserveForArchive).not.toHaveBeenCalled();
    expect(confirmIndexStatus).not.toHaveBeenCalled();
  });
});

describe("SessionLifecycleHandler.autoArchive", () => {
  it("repairs stale index candidates so they cannot block the oldest-first backlog", async () => {
    const fixture = createHandler();
    fixture.session.status = "active";
    expect(await (await fixture.handler.autoArchive()).json()).toEqual({ outcome: "ineligible" });
    expect(fixture.repairIndexStatus).toHaveBeenCalledOnce();
    expect(fixture.autoArchiveEligible).not.toHaveBeenCalled();
  });
  it("archives an old read session through preservation and index confirmation", async () => {
    const fixture = createHandler();
    const response = await fixture.handler.autoArchive();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ outcome: "archived" });
    expect(fixture.autoArchiveEligible).toHaveBeenCalledWith("test-session", expect.any(Number));
    expect(fixture.beginTransition).toHaveBeenCalledWith("archived");
    expect(fixture.preserveForArchive).toHaveBeenCalledOnce();
    expect(fixture.confirmIndexStatus).toHaveBeenCalledWith("archived");
  });

  it("leaves an unread hierarchy untouched", async () => {
    const fixture = createHandler();
    fixture.autoArchiveEligible.mockResolvedValue(false);
    expect(await (await fixture.handler.autoArchive()).json()).toEqual({ outcome: "ineligible" });
    expect(fixture.beginTransition).not.toHaveBeenCalled();
  });

  it("rechecks authoritative state after waiting for the global eligibility read", async () => {
    const fixture = createHandler();
    fixture.autoArchiveEligible.mockImplementation(async () => {
      fixture.session.status = "active";
      return true;
    });
    expect(await (await fixture.handler.autoArchive()).json()).toEqual({ outcome: "ineligible" });
    expect(fixture.beginTransition).not.toHaveBeenCalled();
  });

  it("does not archive newly queued work or recent local activity", async () => {
    const fixture = createHandler();
    fixture.getPendingOrProcessingCount.mockReturnValue(1);
    expect(await (await fixture.handler.autoArchive()).json()).toEqual({ outcome: "ineligible" });
    fixture.getPendingOrProcessingCount.mockReturnValue(0);
    fixture.session.updated_at = Date.now();
    expect(await (await fixture.handler.autoArchive()).json()).toEqual({ outcome: "ineligible" });
    expect(fixture.beginTransition).not.toHaveBeenCalled();
  });

  it("automatically archives old cancelled sessions without changing manual cancellation rules", async () => {
    const fixture = createHandler();
    fixture.session.status = "cancelled";
    fixture.session.updated_at = Date.now() - 8 * 24 * 60 * 60 * 1000;
    expect((await fixture.handler.archive()).status).toBe(409);
    expect(await (await fixture.handler.autoArchive()).json()).toMatchObject({
      outcome: "archived",
    });
  });

  it("fails closed if the global eligibility read fails", async () => {
    const fixture = createHandler();
    fixture.autoArchiveEligible.mockRejectedValue(new Error("D1 unavailable"));
    await expect(fixture.handler.autoArchive()).rejects.toThrow("D1 unavailable");
    expect(fixture.beginTransition).not.toHaveBeenCalled();
  });
});
