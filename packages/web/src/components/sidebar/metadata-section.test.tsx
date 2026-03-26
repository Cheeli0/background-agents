// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom" />

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";
import { MetadataSection } from "./metadata-section";

expect.extend(matchers);

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={typeof href === "string" ? href : "#"} {...props}>
      {children}
    </a>
  ),
}));

describe("MetadataSection", () => {
  it("renders an associated pull request link when available", () => {
    render(
      <MetadataSection
        createdAt={Date.now()}
        baseBranch="main"
        repoOwner="acme"
        repoName="repo"
        associatedPr={{
          number: 42,
          title: "Display associated PR",
          url: "https://github.com/acme/repo/pull/42",
          status: "open",
          checks: {
            state: "pending",
            totalCount: 3,
            successfulCount: 1,
            failedCount: 0,
            pendingCount: 2,
          },
        }}
      />
    );

    const link = screen.getByRole("link", { name: /associated pr #42/i });
    expect(link).toHaveAttribute("href", "https://github.com/acme/repo/pull/42");
    expect(screen.getByText("open")).toBeInTheDocument();
    expect(screen.getByLabelText("2/3 checks pending")).toBeInTheDocument();
  });

  it("renders CI status for session PR artifacts", () => {
    render(
      <MetadataSection
        createdAt={Date.now()}
        baseBranch="main"
        artifacts={[
          {
            id: "pr-1",
            type: "pr",
            url: "https://github.com/acme/repo/pull/7",
            metadata: { prNumber: 7, prState: "open" },
            createdAt: Date.now(),
          },
        ]}
        artifactPr={{
          number: 7,
          url: "https://github.com/acme/repo/pull/7",
          status: "open",
          checks: {
            state: "success",
            totalCount: 4,
            successfulCount: 4,
            failedCount: 0,
            pendingCount: 0,
          },
        }}
      />
    );

    expect(screen.getByRole("link", { name: "#7" })).toHaveAttribute(
      "href",
      "https://github.com/acme/repo/pull/7"
    );
    expect(screen.getByLabelText("4/4 checks passing")).toBeInTheDocument();
  });
});
