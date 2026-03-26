// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom" />

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";
import { SWRConfig } from "swr";
import { MOBILE_LONG_PRESS_MS, SessionSidebar } from "./session-sidebar";
import { useSessionAssociatedPr } from "@/hooks/use-session-associated-pr";
import { buildSessionsPageKey, SIDEBAR_SESSIONS_KEY } from "@/lib/session-list";

expect.extend(matchers);

const { mockUseIsMobile } = vi.hoisted(() => ({
  mockUseIsMobile: vi.fn(() => false),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      user: {
        name: "Test User",
        email: "test@example.com",
      },
    },
  }),
  signOut: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={typeof href === "string" ? href : "#"} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/hooks/use-media-query", () => ({
  useIsMobile: mockUseIsMobile,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  mockUseIsMobile.mockReturnValue(false);
});

function createSession(index: number) {
  return {
    id: `session-${index}`,
    title: `Session ${index}`,
    repoOwner: "open-inspect",
    repoName: "background-agents",
    status: "active",
    createdAt: 1000 + index,
    updatedAt: 2000 + index,
  };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function AssociatedPrProbe({ sessionId }: { sessionId: string }) {
  const { associatedPr } = useSessionAssociatedPr(sessionId);
  return <span>{associatedPr ? `PR #${associatedPr.number}` : "No PR"}</span>;
}

describe("SessionSidebar", () => {
  it("loads the next page when scrolled near the bottom", async () => {
    const firstPage = Array.from({ length: 50 }, (_, index) => createSession(index + 1));
    const secondPage = Array.from({ length: 5 }, (_, index) => createSession(index + 51));

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === SIDEBAR_SESSIONS_KEY) {
        return jsonResponse({ sessions: firstPage, hasMore: true });
      }

      if (url === buildSessionsPageKey({ excludeStatus: "archived", offset: 50 })) {
        return jsonResponse({ sessions: secondPage, hasMore: false });
      }

      if (url.includes("/associated-pr")) {
        return jsonResponse({ pullRequest: null });
      }

      if (url.includes("/artifacts")) {
        return jsonResponse({ artifacts: [] });
      }

      throw new Error(`Unexpected fetch for ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(
      <SWRConfig
        value={{
          provider: () => new Map(),
          dedupingInterval: 0,
          revalidateOnFocus: false,
          fetcher: async (url: string) => {
            const response = await fetch(url);
            return response.json();
          },
        }}
      >
        <SessionSidebar />
      </SWRConfig>
    );

    expect(await screen.findByText("Session 1")).toBeInTheDocument();

    const scrollContainer = container.querySelector(".overflow-y-auto") as HTMLDivElement;
    let scrollTop = 0;

    Object.defineProperty(scrollContainer, "scrollHeight", {
      configurable: true,
      value: 2000,
    });
    Object.defineProperty(scrollContainer, "clientHeight", {
      configurable: true,
      value: 400,
    });
    Object.defineProperty(scrollContainer, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (value) => {
        scrollTop = value;
      },
    });

    scrollTop = 1705;
    fireEvent.scroll(scrollContainer);

    expect(await screen.findByText("Session 55")).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        buildSessionsPageKey({ excludeStatus: "archived", offset: 50 })
      );
    });
  });

  it("navigates directly on mobile tap without opening rename actions", async () => {
    mockUseIsMobile.mockReturnValue(true);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/associated-pr")) {
        return jsonResponse({ pullRequest: null });
      }

      if (url.includes("/artifacts")) {
        return jsonResponse({ artifacts: [] });
      }

      throw new Error(`Unexpected fetch for ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(
      <SWRConfig
        value={{
          fallback: { [SIDEBAR_SESSIONS_KEY]: { sessions: [createSession(1)], hasMore: false } },
          dedupingInterval: 0,
          revalidateOnFocus: false,
        }}
      >
        <SessionSidebar onSessionSelect={vi.fn()} />
      </SWRConfig>
    );

    const link = await screen.findByRole("link", { name: /session 1/i });
    fireEvent.click(link);

    expect(screen.queryByText("Rename")).not.toBeInTheDocument();
  });

  it("opens rename actions on mobile long press", async () => {
    mockUseIsMobile.mockReturnValue(true);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/associated-pr")) {
        return jsonResponse({ pullRequest: null });
      }

      if (url.includes("/artifacts")) {
        return jsonResponse({ artifacts: [] });
      }

      throw new Error(`Unexpected fetch for ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(
      <SWRConfig
        value={{
          fallback: { [SIDEBAR_SESSIONS_KEY]: { sessions: [createSession(1)], hasMore: false } },
          dedupingInterval: 0,
          revalidateOnFocus: false,
        }}
      >
        <SessionSidebar />
      </SWRConfig>
    );

    const link = await screen.findByRole("link", { name: /session 1/i });
    vi.useFakeTimers();
    fireEvent.touchStart(link, { touches: [{ clientX: 20, clientY: 20 }] });
    act(() => {
      vi.advanceTimersByTime(MOBILE_LONG_PRESS_MS);
    });

    expect(screen.getByText("Rename")).toBeInTheDocument();
  });

  it("groups sessions by repository and falls back for missing repository info", async () => {
    vi.spyOn(Date, "now").mockReturnValue(2_000_000_000_000);

    const sessions = [
      {
        ...createSession(1),
        title: "Newest Background Session",
        updatedAt: 2_000_000_000_000,
      },
      {
        ...createSession(2),
        title: "Older Background Session",
        updatedAt: 1_999_999_999_000,
      },
      {
        ...createSession(3),
        title: "Docs Session",
        repoName: "docs",
        updatedAt: 1_999_999_998_000,
      },
      {
        ...createSession(4),
        title: "Unknown Repo Session",
        repoOwner: "",
        repoName: "",
        updatedAt: 1_999_000_000_000,
      },
    ];

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/associated-pr")) {
        return jsonResponse({ pullRequest: null });
      }

      if (url.includes("/artifacts")) {
        return jsonResponse({ artifacts: [] });
      }

      throw new Error(`Unexpected fetch for ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(
      <SWRConfig
        value={{
          fallback: { [SIDEBAR_SESSIONS_KEY]: { sessions, hasMore: false } },
          dedupingInterval: 0,
          revalidateOnFocus: false,
        }}
      >
        <SessionSidebar />
      </SWRConfig>
    );

    const repositoryHeadings = await screen.findAllByRole("heading", {
      name: /repository /i,
    });

    expect(repositoryHeadings.map((heading) => heading.textContent)).toEqual([
      "open-inspect/background-agents",
      "open-inspect/docs",
      "Unknown repository",
    ]);
    expect(screen.getByText("Inactive")).toBeInTheDocument();
    expect(screen.getByText("Unknown Repo Session")).toBeInTheDocument();
  });

  it("shows merged and closed PR status indicators in the sessions list", async () => {
    const sessions = [
      createSession(1),
      { ...createSession(2), title: "Session 2 with a very long title that should truncate in sidebar" },
      createSession(3),
    ];

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === SIDEBAR_SESSIONS_KEY) {
        return jsonResponse({ sessions, hasMore: false });
      }

      if (url.endsWith("/session-1/associated-pr")) {
        return jsonResponse({ pullRequest: { status: "open" } });
      }

      if (url.endsWith("/session-2/associated-pr")) {
        return jsonResponse({ pullRequest: { status: "merged" } });
      }

      if (url.endsWith("/session-3/associated-pr")) {
        return jsonResponse({ pullRequest: { status: "closed" } });
      }

      throw new Error(`Unexpected fetch for ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(
      <SWRConfig
        value={{
          provider: () => new Map(),
          dedupingInterval: 0,
          revalidateOnFocus: false,
          fetcher: async (url: string) => {
            const response = await fetch(url);
            return response.json();
          },
        }}
      >
        <SessionSidebar />
      </SWRConfig>
    );

    expect(await screen.findByText("Session 1")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByLabelText("PR merged")).toBeInTheDocument();
      expect(screen.getByLabelText("PR closed")).toBeInTheDocument();
    });

    expect(screen.getByLabelText("PR open")).toBeInTheDocument();

    const mergedIndicator = screen.getByLabelText("PR merged");
    const closedIndicator = screen.getByLabelText("PR closed");
    const longTitle = screen.getByText(
      "Session 2 with a very long title that should truncate in sidebar"
    );
    const mergedRow = longTitle.closest("a");

    expect(mergedIndicator).toHaveClass("text-[#8250df]");
    expect(closedIndicator).toHaveClass("text-[#cf222e]");
    expect(mergedRow).toContainElement(mergedIndicator);
    expect(mergedIndicator.compareDocumentPosition(longTitle) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it("keeps associated PR cache isolated from sidebar status cache", async () => {
    const sessions = [createSession(1)];

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/session-1/associated-pr")) {
        return jsonResponse({
          pullRequest: {
            number: 101,
            title: "Improve status indicator",
            url: "https://github.com/open-inspect/background-agents/pull/101",
            status: "merged",
          },
        });
      }

      throw new Error(`Unexpected fetch for ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(
      <SWRConfig
        value={{
          provider: () => new Map(),
          fallback: {
            [SIDEBAR_SESSIONS_KEY]: { sessions, hasMore: false },
          },
          dedupingInterval: 0,
          revalidateOnFocus: false,
        }}
      >
        <>
          <SessionSidebar />
          <AssociatedPrProbe sessionId="session-1" />
        </>
      </SWRConfig>
    );

    expect(await screen.findByText("PR #101")).toBeInTheDocument();
    expect(screen.getByLabelText("PR merged")).toBeInTheDocument();
  });

  it("falls back to artifact PR status for existing sessions", async () => {
    const sessions = [createSession(1)];

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === SIDEBAR_SESSIONS_KEY) {
        return jsonResponse({ sessions, hasMore: false });
      }

      if (url.endsWith("/session-1/associated-pr")) {
        return jsonResponse({ pullRequest: null });
      }

      if (url.endsWith("/session-1/artifacts")) {
        return jsonResponse({
          artifacts: [
            {
              id: "artifact-1",
              type: "pr",
              createdAt: 1234,
              metadata: { prState: "merged" },
            },
          ],
        });
      }

      throw new Error(`Unexpected fetch for ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(
      <SWRConfig
        value={{
          provider: () => new Map(),
          dedupingInterval: 0,
          revalidateOnFocus: false,
          fetcher: async (url: string) => {
            const response = await fetch(url);
            return response.json();
          },
        }}
      >
        <SessionSidebar />
      </SWRConfig>
    );

    expect(await screen.findByLabelText("PR merged")).toBeInTheDocument();
  });

  it("falls back to artifact PR status when associated PR lookup fails", async () => {
    const sessions = [createSession(1)];

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === SIDEBAR_SESSIONS_KEY) {
        return jsonResponse({ sessions, hasMore: false });
      }

      if (url.endsWith("/session-1/associated-pr")) {
        return new Response(JSON.stringify({ error: "failed" }), { status: 500 });
      }

      if (url.endsWith("/session-1/artifacts")) {
        return jsonResponse({
          artifacts: [
            {
              id: "artifact-1",
              type: "pr",
              createdAt: 1234,
              metadata: { prState: "merged" },
            },
          ],
        });
      }

      throw new Error(`Unexpected fetch for ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(
      <SWRConfig
        value={{
          provider: () => new Map(),
          dedupingInterval: 0,
          revalidateOnFocus: false,
          fetcher: async (url: string) => {
            const response = await fetch(url);
            return response.json();
          },
        }}
      >
        <SessionSidebar />
      </SWRConfig>
    );

    expect(await screen.findByText("Session 1")).toBeInTheDocument();
    expect(await screen.findByLabelText("PR merged")).toBeInTheDocument();
  });
});
