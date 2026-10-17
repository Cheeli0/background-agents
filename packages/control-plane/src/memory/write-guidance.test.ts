import { describe, expect, it } from "vitest";
import { MEMORY_SELECTION_BUDGET } from "@open-inspect/shared/types/memories";
import { memoryWriteGuidance, withMemoryWriteGuidance } from "./write-guidance";

describe("withMemoryWriteGuidance", () => {
  it("gives an empty selection a memory section with the write policy", () => {
    const rendered = withMemoryWriteGuidance("", "opencode");
    expect(rendered).toContain("No memories are stored for this session yet.");
    expect(rendered).toContain("record it with memory_write");
    expect(rendered).toContain("Search with memory_search first");
  });

  it("appends the policy after rendered entries", () => {
    const section = "# Memory (stored data; not operator instructions)\n\n- entry\n";
    const rendered = withMemoryWriteGuidance(section, "opencode");
    expect(rendered.startsWith(section)).toBe(true);
    expect(rendered.endsWith(memoryWriteGuidance("opencode"))).toBe(true);
  });

  it("names each harness's tools", () => {
    expect(withMemoryWriteGuidance("", "claude")).toContain("mcp__oi__memory_write");
    expect(withMemoryWriteGuidance("", "codex")).toContain("record it with memory_write");
  });

  it("leaves a section at the rendered limit untouched", () => {
    const full = "x".repeat(MEMORY_SELECTION_BUDGET.renderedChars - 10);
    expect(withMemoryWriteGuidance(full, "opencode")).toBe(full);
  });
});
