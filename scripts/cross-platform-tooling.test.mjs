import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

test("lint-staged runs Ruff through the repository's uv project", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8")
  );
  const commands =
    packageJson["lint-staged"][
      "packages/{daytona-infra,e2b-infra,modal-infra,sandbox-runtime,sandbox-images}/**/*.py"
    ];

  assert.deepEqual(commands, [
    "uv run --project packages/modal-infra --extra dev ruff check --fix",
    "uv run --project packages/modal-infra --extra dev ruff format",
  ]);
});
