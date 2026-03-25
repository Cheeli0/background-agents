import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LinearApiClient } from "./linear-client";
import {
  fetchAgentSessionPullRequests,
  fetchIssueDetails,
  getFirstStartedWorkflowState,
  moveIssueToStartedStateIfNeeded,
} from "./linear-client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("linear-client workflow helpers", () => {
  const client: LinearApiClient = { accessToken: "test-token" };
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("fetchIssueDetails returns workflow state metadata", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({
        data: {
          issue: {
            id: "issue-1",
            identifier: "ENG-1",
            title: "Test issue",
            description: "Body",
            url: "https://linear.app/acme/issue/ENG-1/test-issue",
            priority: 0,
            priorityLabel: "No priority",
            labels: { nodes: [] },
            project: null,
            assignee: null,
            state: { id: "state-backlog", name: "Backlog", type: "backlog" },
            team: { id: "team-1", key: "ENG", name: "Engineering" },
            comments: { nodes: [] },
          },
        },
      })
    );

    const issue = await fetchIssueDetails(client, "issue-1");

    expect(issue?.state).toEqual({ id: "state-backlog", name: "Backlog", type: "backlog" });
  });

  it("fetchAgentSessionPullRequests normalizes linked pull requests", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({
        data: {
          agentSession: {
            pullRequests: {
              nodes: [
                {
                  pullRequest: {
                    id: "pr-1",
                    number: 42,
                    title: "Fix session panel",
                    url: "https://github.com/acme/repo/pull/42",
                    status: "inReview",
                  },
                },
                {
                  pullRequest: {
                    id: "pr-2",
                    number: 43,
                    title: "Follow-up",
                    url: "https://github.com/acme/repo/pull/43",
                    status: "merged",
                  },
                },
              ],
            },
          },
        },
      })
    );

    const pullRequests = await fetchAgentSessionPullRequests(client, "agent-session-1");

    expect(pullRequests).toEqual([
      {
        id: "pr-1",
        number: 42,
        title: "Fix session panel",
        url: "https://github.com/acme/repo/pull/42",
        status: "open",
      },
      {
        id: "pr-2",
        number: 43,
        title: "Follow-up",
        url: "https://github.com/acme/repo/pull/43",
        status: "merged",
      },
    ]);
  });

  it("getFirstStartedWorkflowState picks the lowest position started state", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({
        data: {
          team: {
            states: {
              nodes: [
                { id: "state-2", name: "In Progress", type: "started", position: 20 },
                { id: "state-1", name: "Todo", type: "started", position: 10 },
              ],
            },
          },
        },
      })
    );

    const result = await getFirstStartedWorkflowState(client, "team-1");

    expect(result).toEqual({
      status: "found",
      reason: "started_state_found",
      state: { id: "state-1", name: "Todo", type: "started", position: 10 },
    });
  });

  it("getFirstStartedWorkflowState reports GraphQL failures", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({
        errors: [{ message: "Bad query" }],
      })
    );

    const result = await getFirstStartedWorkflowState(client, "team-1");

    expect(result).toEqual({
      status: "failed",
      reason: "started_state_lookup_failed",
      state: null,
    });
  });

  it("moveIssueToStartedStateIfNeeded skips started/completed/canceled states", async () => {
    for (const currentStateType of ["started", "completed", "canceled"]) {
      vi.mocked(globalThis.fetch).mockClear();

      const result = await moveIssueToStartedStateIfNeeded(client, {
        issueId: "issue-1",
        teamId: "team-1",
        currentStateId: "state-1",
        currentStateType,
      });

      expect(result.status).toBe("skipped");
      expect(globalThis.fetch).not.toHaveBeenCalled();
    }
  });

  it("moveIssueToStartedStateIfNeeded updates backlog issues to the first started state", async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            team: {
              states: {
                nodes: [
                  { id: "state-2", name: "Doing", type: "started", position: 30 },
                  { id: "state-1", name: "In Progress", type: "started", position: 10 },
                ],
              },
            },
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            issueUpdate: {
              success: true,
            },
          },
        })
      );

    const result = await moveIssueToStartedStateIfNeeded(client, {
      issueId: "issue-1",
      teamId: "team-1",
      currentStateId: "state-backlog",
      currentStateType: "backlog",
    });

    expect(result).toEqual({
      status: "updated",
      reason: "issue_moved_to_started",
      targetState: { id: "state-1", name: "In Progress", type: "started", position: 10 },
    });

    const [, updateCall] = vi.mocked(globalThis.fetch).mock.calls;
    const updateBody = JSON.parse(String(updateCall?.[1]?.body)) as {
      variables: { input: { stateId: string } };
    };
    expect(updateBody.variables.input.stateId).toBe("state-1");
  });

  it("moveIssueToStartedStateIfNeeded is a no-op when no started states exist", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({
        data: {
          team: {
            states: {
              nodes: [],
            },
          },
        },
      })
    );

    const result = await moveIssueToStartedStateIfNeeded(client, {
      issueId: "issue-1",
      teamId: "team-1",
      currentStateId: "state-backlog",
      currentStateType: "unstarted",
    });

    expect(result).toEqual({
      status: "skipped",
      reason: "no_started_state",
      targetState: null,
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("moveIssueToStartedStateIfNeeded surfaces started-state lookup GraphQL errors as failures", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({
        errors: [{ message: "Lookup failed" }],
      })
    );

    const result = await moveIssueToStartedStateIfNeeded(client, {
      issueId: "issue-1",
      teamId: "team-1",
      currentStateId: "state-backlog",
      currentStateType: "backlog",
    });

    expect(result).toEqual({
      status: "failed",
      reason: "started_state_lookup_failed",
    });
  });
});
