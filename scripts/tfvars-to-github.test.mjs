import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildPlan,
  entryStatus,
  parseBackend,
  parseTfvars,
  parseVariables,
  parseWorkflow,
} from "./tfvars-to-github.mjs";

test("parses scalars, comments and heredocs as Terraform sees them", () => {
  const values = parseTfvars(
    [
      "# comment",
      'name = "a \\"quoted\\" value" # trailing',
      "count = 3300",
      "flag  = false",
      'empty = ""',
      "key = <<-EOF",
      "  line one",
      "  line two",
      "  EOF",
    ].join("\r\n")
  );
  assert.equal(values.get("name"), 'a "quoted" value');
  assert.equal(values.get("count"), "3300");
  assert.equal(values.get("flag"), "false");
  assert.equal(values.get("empty"), "");
  assert.equal(values.get("key"), "line one\nline two\n");
});

test("rejects values it cannot represent without echoing them", () => {
  assert.throws(
    () => parseTfvars('list = ["secret-value"]'),
    (error) => {
      assert.match(error.message, /^list:/);
      assert.doesNotMatch(error.message, /secret-value/);
      return true;
    }
  );
});

test("reads every workflow mapping and its fallback", () => {
  const workflow = parseWorkflow(
    [
      "        env:",
      "          TF_VAR_api_key: ${{ secrets.API_KEY }}",
      `          TF_VAR_provider: "\${{ vars.PROVIDER || secrets.PROVIDER || 'modal' }}"`,
    ].join("\n")
  );
  assert.deepEqual(workflow.get("api_key"), { vars: null, secrets: "API_KEY", fallback: null });
  assert.deepEqual(workflow.get("provider"), {
    vars: "PROVIDER",
    secrets: "PROVIDER",
    fallback: "modal",
  });
});

const inputs = (tfvars, extra = {}) => ({
  tfvars: new Map(Object.entries(tfvars)),
  workflow: parseWorkflow(
    [
      "  TF_VAR_api_key: ${{ secrets.API_KEY }}",
      `  TF_VAR_provider: "\${{ vars.PROVIDER || secrets.PROVIDER || 'modal' }}"`,
      `  TF_VAR_token: \${{ vars.TOKEN || secrets.TOKEN }}`,
      `  TF_VAR_timeout: "\${{ vars.TIMEOUT || '7200' }}"`,
    ].join("\n")
  ),
  variables: parseVariables(
    [
      'variable "token" {',
      "  sensitive = true",
      "}",
      'variable "timeout" {',
      "  default = 7200",
      "}",
      'variable "local_only" {',
      '  default = "x"',
      "}",
    ].join("\n")
  ),
  backend: { accessKey: "ak", secretKey: "sk", accountId: undefined },
  ...extra,
});

test("sends sensitive values to secrets and plain settings to variables", () => {
  const plan = buildPlan(inputs({ api_key: "k", provider: "daytona", token: "t" }));
  assert.deepEqual(plan.errors, []);
  const byName = Object.fromEntries(plan.entries.map((e) => [e.name, e.kind]));
  assert.deepEqual(byName, {
    API_KEY: "secret",
    PROVIDER: "variable",
    TOKEN: "secret",
    R2_ACCESS_KEY_ID: "secret",
    R2_SECRET_ACCESS_KEY: "secret",
  });
});

test("flags values CI would silently replace", () => {
  const plan = buildPlan(inputs({ provider: "", local_only: "changed" }));
  assert.ok(plan.errors.some((e) => e.startsWith("provider: empty locally")));
  assert.ok(plan.errors.some((e) => e.startsWith("local_only: set locally")));
});

test("warns when a default left out of tfvars differs in CI", () => {
  const plan = buildPlan(
    inputs({}, { workflow: parseWorkflow(`  TF_VAR_timeout: "\${{ vars.TIMEOUT || '3600' }}"`) })
  );
  assert.ok(plan.warnings.some((w) => w.startsWith("timeout: not in tfvars")));
});

test("reports a variable that shadows a secret of the same name", () => {
  const remote = { secrets: new Map([["TOKEN", "t"]]), variables: new Map([["TOKEN", "x"]]) };
  assert.equal(entryStatus({ kind: "secret", name: "TOKEN", value: "t" }, remote), "shadowed");
  assert.equal(entryStatus({ kind: "variable", name: "TOKEN", value: "x" }, remote), "match");
});

test("extracts R2 credentials and the account id from backend.tfvars", () => {
  const backend = parseBackend(
    'access_key = "ak"\nsecret_key = "sk"\nendpoints = {\n  s3 = "https://abc123.r2.cloudflarestorage.com"\n}\n'
  );
  assert.deepEqual(backend, { accessKey: "ak", secretKey: "sk", accountId: "abc123" });
});

test("the real workflow maps plan and apply identically", () => {
  const workflow = parseWorkflow(
    readFileSync(new URL("../.github/workflows/terraform.yml", import.meta.url), "utf8")
  );
  assert.ok(workflow.size > 80);
  assert.equal(workflow.get("sandbox_provider").fallback, "modal");
});
