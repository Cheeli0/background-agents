import type { Logger } from "../../../logger";
import type { SandboxBootstrapStore } from "../../../sandbox/bootstrap";
import { isSandboxReconnectBlockedStatus } from "../../../sandbox/lifecycle/decisions";
import type { SandboxStateReader } from "../../sandbox-ports";

const BEARER_PREFIX = "Bearer ";

export class SandboxBootstrapHandler {
  constructor(
    private readonly store: SandboxBootstrapStore,
    private readonly sandboxRepository: SandboxStateReader,
    private readonly now: () => number = Date.now
  ) {}

  async redeem(request: Request, log: Logger): Promise<Response> {
    const authorization = request.headers.get("Authorization");
    const token = authorization?.startsWith(BEARER_PREFIX)
      ? authorization.slice(BEARER_PREFIX.length)
      : "";
    if (!token) return respondUnauthorized();

    let record;
    try {
      record = await this.store.consume(token, this.now());
    } catch (error) {
      log.error("Sandbox bootstrap could not be read", {
        event: "sandbox.bootstrap_failed",
        error: error instanceof Error ? error : String(error),
      });
      throw error;
    }
    if (!record) {
      log.warn("Sandbox bootstrap refused: unknown, used or expired token", {
        event: "sandbox.bootstrap_refused",
        reason: "token",
      });
      return respondUnauthorized();
    }

    const sandbox = this.sandboxRepository.getSandbox();
    if (
      !sandbox ||
      sandbox.modal_sandbox_id !== record.sandboxId ||
      isSandboxReconnectBlockedStatus(sandbox.status)
    ) {
      log.warn("Sandbox bootstrap refused: generation is not current", {
        event: "sandbox.bootstrap_refused",
        reason: "generation",
        sandbox_id: record.sandboxId,
      });
      return respondUnauthorized();
    }

    log.info("Sandbox bootstrap redeemed", {
      event: "sandbox.bootstrap_redeemed",
      sandbox_id: record.sandboxId,
    });
    return Response.json(
      { sandboxId: record.sandboxId, env: record.env },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}

function respondUnauthorized(): Response {
  return Response.json({ error: "Invalid bootstrap token" }, { status: 401 });
}
