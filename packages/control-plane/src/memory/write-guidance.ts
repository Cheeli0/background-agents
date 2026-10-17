/**
 * Fork-only: tell agents when to save memories.
 *
 * Upstream renders nothing when a session has no pinned memories, so an empty
 * store never shows the agent any memory context and nothing ever gets
 * written. This adds a short write policy to every session's rendered boot
 * context instead. It is applied where the sandbox fetches the render, so the
 * pinned selection, its hash, and its token estimate are unchanged.
 */

import type { HarnessId } from "@open-inspect/shared/harnesses";
import { harnessMemoryToolName } from "@open-inspect/shared/memory-tools";
import { MEMORY_SELECTION_BUDGET } from "@open-inspect/shared/types/memories";

const EMPTY_MEMORY_HEADING = "# Memory\n\nNo memories are stored for this session yet.\n";

export function memoryWriteGuidance(harness: HarnessId): string {
  const write = harnessMemoryToolName(harness, "memory_write");
  const search = harnessMemoryToolName(harness, "memory_search");
  return (
    `\n## Saving memories\n\n` +
    `Before you finish, if you learned something durable and non-obvious that would save a future ` +
    `session time in this repository or environment, record it with ${write} as a fact. Good ` +
    `candidates: setup, build or test steps that were not obvious; environment or tooling gotchas; ` +
    `conventions you had to infer; a recurring failure and its fix. You do not need to be asked. ` +
    `Search with ${search} first and skip anything already recorded. Write one concise fact per ` +
    `topic. Do not record task-specific details, anything the repository's own docs already say, ` +
    `or credentials. Writes may need approval before other sessions see them; that is expected.\n`
  );
}

/** Append the write policy to a rendered section, or stand it alone when nothing is pinned. */
export function withMemoryWriteGuidance(rendered: string, harness: HarnessId): string {
  const guided = `${rendered || EMPTY_MEMORY_HEADING}${memoryWriteGuidance(harness)}`;
  // A section already at the rendered limit stays as rendered rather than being truncated.
  return guided.length <= MEMORY_SELECTION_BUDGET.renderedChars ? guided : rendered;
}
