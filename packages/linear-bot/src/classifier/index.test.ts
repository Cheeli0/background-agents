import { describe, expect, it } from "vitest";
import { buildGitHubModelsTemperature, buildGitHubModelsTokenLimit } from "./index";

describe("buildGitHubModelsTokenLimit", () => {
  it("uses max_completion_tokens for GPT-5 GitHub Models requests", () => {
    expect(buildGitHubModelsTokenLimit("openai/gpt-5-mini", 500)).toEqual({
      max_completion_tokens: 500,
    });
  });

  it("keeps max_tokens for non-GPT-5 GitHub Models requests", () => {
    expect(buildGitHubModelsTokenLimit("openai/gpt-4.1", 500)).toEqual({
      max_tokens: 500,
    });
    expect(buildGitHubModelsTokenLimit("anthropic/claude-haiku-4-5", 500)).toEqual({
      max_tokens: 500,
    });
  });
});

describe("buildGitHubModelsTemperature", () => {
  it("omits temperature for GPT-5 GitHub Models requests", () => {
    expect(buildGitHubModelsTemperature("openai/gpt-5-mini")).toEqual({});
  });

  it("keeps temperature 0 for non-GPT-5 GitHub Models requests", () => {
    expect(buildGitHubModelsTemperature("openai/gpt-4.1")).toEqual({
      temperature: 0,
    });
  });
});
