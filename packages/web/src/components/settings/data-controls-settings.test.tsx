// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom" />

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";
import { SWRConfig } from "swr";
import { DataControlsSettings } from "./data-controls-settings";

expect.extend(matchers);

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={typeof href === "string" ? href : "#"} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe("DataControlsSettings", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("shows the session panel auto-archive preference and updates local storage", () => {
    render(
      <SWRConfig
        value={{
          provider: () => new Map(),
          fallback: { "/api/sessions?status=archived&limit=20&offset=0": { sessions: [] } },
          dedupingInterval: 0,
          revalidateOnFocus: false,
        }}
      >
        <DataControlsSettings />
      </SWRConfig>
    );

    const toggle = screen.getByRole("switch", {
      name: /auto-archive closed or merged prs/i,
    });

    expect(toggle).toHaveAttribute("data-state", "checked");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("data-state", "unchecked");
    expect(localStorage.getItem("session-panel-preferences")).toBe(
      JSON.stringify({ autoArchiveClosedOrMergedPrSessions: false })
    );
  });
});
