// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom" />

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";
import { ReasoningEffortPills } from "./reasoning-effort-pills";

expect.extend(matchers);

afterEach(cleanup);

describe("ReasoningEffortPills", () => {
  it("renders the current reasoning control for supported models", () => {
    const onSelect = vi.fn();

    render(
      <ReasoningEffortPills
        selectedModel="anthropic/claude-opus-4-6"
        reasoningEffort="medium"
        onSelect={onSelect}
        disabled={false}
      />
    );

    expect(screen.getByRole("button", { name: "medium" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "medium" }));

    expect(onSelect).toHaveBeenCalledWith("high");
  });

  it("shows an unavailable state for unsupported models instead of disappearing", () => {
    render(
      <ReasoningEffortPills
        selectedModel="github-copilot/gemini-3-flash"
        reasoningEffort={undefined}
        onSelect={vi.fn()}
        disabled={false}
      />
    );

    expect(screen.getByText("reasoning unavailable")).toBeInTheDocument();
  });
});
