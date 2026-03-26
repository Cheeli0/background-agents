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

  it("shows provider information alongside model", () => {
    render(
      <MetadataSection
        createdAt={Date.now()}
        baseBranch="main"
        model="openai/gpt-5.3-codex"
        reasoningEffort="high"
      />
    );

    expect(screen.getByText("GPT 5.3 Codex")).toBeInTheDocument();
    expect(screen.getByText("Provider: OpenAI")).toBeInTheDocument();
  });

  it("shows Z.AI as the provider for GLM models", () => {
    render(
      <MetadataSection createdAt={Date.now()} baseBranch="main" model="zai-coding-plan/glm-5" />
    );

    expect(screen.getByText("GLM 5")).toBeInTheDocument();
    expect(screen.getByText("Provider: Z.AI")).toBeInTheDocument();
  });

  it("shows unknown when provider cannot be determined", () => {
    render(
      <MetadataSection
        createdAt={Date.now()}
        baseBranch="main"
        model="custom-model-without-prefix"
      />
    );

    expect(screen.getByText("custom-model-without-prefix")).toBeInTheDocument();
    expect(screen.getByText("Provider: Unknown")).toBeInTheDocument();
  });
});
