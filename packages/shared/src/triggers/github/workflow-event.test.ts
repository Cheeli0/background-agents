import { describe, expect, it } from "vitest";
import { matchesConditions, validateTriggerConditions } from "../conditions";
import { conditionRegistry } from "../registry";
import { githubAutomationEventSchema, triggerConfigSchema } from "../types";
import { normalizeGitHubEvent } from "./normalizer";

function workflowPayload(event?: string) {
  return {
    action: "completed",
    repository: { id: 9001, name: "app", owner: { login: "acme" } },
    workflow_run: {
      id: 123,
      run_attempt: 1,
      name: "CI",
      conclusion: "success",
      head_branch: "feature/anything",
      event,
    },
  };
}

describe("workflow source event filtering", () => {
  it.each(["pull_request", "push", "workflow_dispatch", "schedule"])(
    "preserves %s through normalization and serialization",
    (workflowEvent) => {
      const event = normalizeGitHubEvent("workflow_run", workflowPayload(workflowEvent));
      expect(event).toHaveProperty("workflowEvent", workflowEvent);
      expect(githubAutomationEventSchema.parse(event)).toHaveProperty(
        "workflowEvent",
        workflowEvent
      );
      expect(event?.contextBlock).toContain(`Workflow event: ${workflowEvent}`);
    }
  );

  it("matches only PR runs and fails closed when the source event is missing", () => {
    const { conditions } = triggerConfigSchema.parse({
      conditions: [{ type: "workflow_event", operator: "eq", value: "pull_request" }],
    });
    for (const source of ["pull_request", "push", "workflow_dispatch", "schedule", undefined]) {
      const event = normalizeGitHubEvent("workflow_run", workflowPayload(source));
      if (!event) throw new Error("Expected normalized workflow run");
      expect(matchesConditions(conditions, event, conditionRegistry)).toBe(
        source === "pull_request"
      );
      expect(matchesConditions([], event, conditionRegistry)).toBe(true);
    }
  });

  it("offers the filter only on workflow runs and rejects blank event names", () => {
    const { conditions } = triggerConfigSchema.parse({
      conditions: [{ type: "workflow_event", operator: "eq", value: "pull_request" }],
    });
    expect(
      validateTriggerConditions(
        { type: "github_event", eventType: "workflow_run.completed", conditions },
        conditionRegistry
      )
    ).toEqual([]);
    expect(
      validateTriggerConditions(
        { type: "github_event", eventType: "pull_request.opened", conditions },
        conditionRegistry
      )
    ).not.toEqual([]);
    const blank = triggerConfigSchema.parse({
      conditions: [{ type: "workflow_event", operator: "eq", value: " " }],
    });
    expect(
      validateTriggerConditions(
        { type: "github_event", eventType: "workflow_run.completed", conditions: blank.conditions },
        conditionRegistry
      )
    ).not.toEqual([]);
  });
});
