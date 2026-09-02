import assert from "node:assert/strict";
import test from "node:test";

import { buildDeploySteps, buildSecretSteps, parseSecrets } from "./modal-helper.mjs";

test("builds secret commands without a shell", () => {
  const secrets = parseSecrets(
    JSON.stringify([{ name: "llm-api-keys", values: { ANTHROPIC_API_KEY: "a b$c" } }])
  );

  assert.deepEqual(buildSecretSteps(secrets, "C:\\repo\\packages\\modal-infra"), [
    {
      args: [
        "run",
        "--directory",
        "C:\\repo\\packages\\modal-infra",
        "modal",
        "secret",
        "create",
        "llm-api-keys",
        "ANTHROPIC_API_KEY=a b$c",
        "--force",
      ],
      label: "secret llm-api-keys",
    },
  ]);
});

test("rejects unsafe secret and environment variable names", () => {
  assert.throws(
    () => parseSecrets(JSON.stringify([{ name: "bad/name", values: { TOKEN: "x" } }])),
    /Invalid secret name/
  );
  assert.throws(
    () => parseSecrets(JSON.stringify([{ name: "valid", values: { "BAD-NAME": "x" } }])),
    /Invalid key name/
  );
});

test("preserves upstream deploy preparation for the deploy module", () => {
  assert.deepEqual(buildDeploySteps("deploy"), [
    { args: ["sync", "--frozen"], label: "dependency sync" },
    {
      args: ["run", "python", "deploy.py", "--build-sandbox-image"],
      label: "sandbox image build",
    },
    { args: ["run", "modal", "deploy", "deploy.py"], label: "Modal deployment" },
  ]);
});

test("does not build the sandbox image for a custom deploy target", () => {
  assert.deepEqual(buildDeploySteps("custom.py"), [
    { args: ["sync", "--frozen"], label: "dependency sync" },
    { args: ["run", "modal", "deploy", "custom.py"], label: "Modal deployment" },
  ]);
});
