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
        }}
      />
    );

    const link = screen.getByRole("link", { name: /associated pr #42/i });
    expect(link).toHaveAttribute("href", "https://github.com/acme/repo/pull/42");
    expect(screen.getByText("open")).toBeInTheDocument();
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
