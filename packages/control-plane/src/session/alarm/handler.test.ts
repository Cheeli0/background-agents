import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../../logger";
import type { SandboxAlarmResult } from "../../sandbox/lifecycle/ports";
import type { MessageRepository } from "../message-repository";
import { createAlarmHandler } from "./handler";

function createFixture(options: {
  lifecycleResult: SandboxAlarmResult;
  launchFailure: string | null;
  bootPromptId: string | null;
}) {
  const failPendingMessage = vi.fn(async (_id: string, _reason: string) => {});
  const redriveIdleQueue = vi.fn(async () => {});
  const handler = createAlarmHandler({
    repository: {
      getProcessingMessageWithStartedAt: () => null,
      getNextPendingMessage: () => (options.bootPromptId ? { id: options.bootPromptId } : null),
    } as unknown as MessageRepository,
    messageQueue: {
      failStuckProcessingMessage: vi.fn(async () => {}),
      failPendingMessage,
    },
    executionStop: {
      recoverStopConfirmationTimeout: vi.fn(async () => {}),
      resumeAfterSandboxTermination: vi.fn(async () => {}),
    },
    lifecycleManager: { handleAlarm: vi.fn(async () => options.lifecycleResult) },
    terminalMessageProjection: { flushPending: vi.fn(async () => {}) },
    alarmScheduler: {
      schedule: vi.fn(async () => {}),
      cancel: vi.fn(async () => {}),
      current: vi.fn(async () => null),
    },
    redriveIdleQueue,
    launchFailure: () => options.launchFailure,
    getExecutionTimeoutMs: () => 60_000,
    now: () => Date.now(),
    log: createLogger("alarm-handler-test", {}, "error"),
  });
  return { handler, failPendingMessage, redriveIdleQueue };
}

describe("alarm handler: a launch that left nothing able to connect (fork)", () => {
  it("fails the waiting boot prompt with the launch's reason", async () => {
    const f = createFixture({
      lifecycleResult: "no_action",
      launchFailure: "Failed to create sandbox with HTTP 404",
      bootPromptId: "msg-boot",
    });

    await f.handler.handle();

    expect(f.failPendingMessage).toHaveBeenCalledExactlyOnceWith(
      "msg-boot",
      "Failed to create sandbox with HTTP 404"
    );
  });

  it("leaves the prompt alone when a launch since then can still connect", async () => {
    const f = createFixture({
      lifecycleResult: "no_action",
      launchFailure: null,
      bootPromptId: "msg-boot",
    });

    await f.handler.handle();

    expect(f.failPendingMessage).not.toHaveBeenCalled();
    expect(f.redriveIdleQueue).toHaveBeenCalledOnce();
  });

  it("does nothing without a waiting prompt", async () => {
    const f = createFixture({
      lifecycleResult: "no_action",
      launchFailure: "Failed to create sandbox",
      bootPromptId: null,
    });

    await f.handler.handle();

    expect(f.failPendingMessage).not.toHaveBeenCalled();
  });

  it("keeps the lifecycle's own boot failure when it reports one", async () => {
    const f = createFixture({
      lifecycleResult: { kind: "boot_budget_exceeded", reason: "Boot exceeded its budget" },
      launchFailure: "Failed to create sandbox",
      bootPromptId: "msg-boot",
    });

    await f.handler.handle();

    expect(f.failPendingMessage).toHaveBeenCalledExactlyOnceWith(
      "msg-boot",
      "Boot exceeded its budget"
    );
  });
});
