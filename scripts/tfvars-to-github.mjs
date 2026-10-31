#!/usr/bin/env node
// Mirror terraform/environments/production/terraform.tfvars (and the R2 backend
// credentials) into the GitHub secrets and variables the Terraform workflow reads.
//
//   node scripts/tfvars-to-github.mjs                 dry run: show the mapping, change nothing
//   node scripts/tfvars-to-github.mjs --apply         push every entry
//   node scripts/tfvars-to-github.mjs --apply --only SANDBOX_PROVIDER,daytona_api_key
//   node scripts/tfvars-to-github.mjs --verify        compare GitHub against tfvars
//
// Secret values are never printed. Variables are shown because GitHub shows them too.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_DIR = join(ROOT, "terraform/environments/production");
const WORKFLOW = join(ROOT, ".github/workflows/terraform.yml");

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function unescapeHcl(body) {
  return body.replace(/\\(u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/g, (_, esc) => {
    if (esc[0] === "u" || esc[0] === "U") return String.fromCodePoint(parseInt(esc.slice(1), 16));
    const map = { n: "\n", r: "\r", t: "\t", '"': '"', "\\": "\\" };
    if (!(esc in map)) throw new Error(`unsupported escape \\${esc}`);
    return map[esc];
  });
}

/** Parse a single-line scalar: "string", number, or bool, with an optional trailing comment. */
export function parseScalar(raw) {
  const text = raw.trim();
  const str = /^"((?:[^"\\]|\\.)*)"\s*(?:(?:#|\/\/).*)?$/.exec(text);
  if (str) return unescapeHcl(str[1]);
  const bare = /^(-?\d+(?:\.\d+)?|true|false)\s*(?:(?:#|\/\/).*)?$/.exec(text);
  if (bare) return bare[1];
  return undefined;
}

/** Parse a tfvars file of scalars and heredocs. Values are returned as Terraform would see them. */
export function parseTfvars(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const values = new Map();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(#|\/\/|$)/.test(line)) continue;
    const assign = /^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(.*)$/.exec(line);
    if (!assign) throw new Error(`line ${i + 1}: cannot parse`);
    const [, key, rest] = assign;
    const heredoc = /^<<(-?)([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(rest);
    if (heredoc) {
      const body = [];
      const end = heredoc[2];
      while (++i < lines.length && lines[i].trim() !== end) body.push(lines[i]);
      if (i >= lines.length) throw new Error(`${key}: unterminated heredoc`);
      let out = body;
      if (heredoc[1] === "-") {
        const indents = body.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)[0].length);
        const strip = indents.length ? Math.min(...indents) : 0;
        out = body.map((l) => l.slice(strip));
      }
      values.set(key, out.join("\n") + "\n");
      continue;
    }
    const value = parseScalar(rest);
    if (value === undefined)
      throw new Error(`${key}: only strings, numbers, bools and heredocs are supported`);
    values.set(key, value);
  }
  return values;
}

/** Read `TF_VAR_x: ${{ vars.A || secrets.B || 'default' }}` mappings from the workflow. */
export function parseWorkflow(text) {
  const mappings = new Map();
  const re = /^\s+TF_VAR_([a-z0-9_]+):\s*"?\$\{\{\s*(.+?)\s*\}\}"?\s*$/gm;
  for (const [, tfvar, expr] of text.matchAll(re)) {
    const mapping = { vars: null, secrets: null, fallback: null };
    for (const part of expr.split("||").map((p) => p.trim())) {
      const ref = /^(vars|secrets)\.([A-Z0-9_]+)$/.exec(part);
      if (ref) mapping[ref[1]] = ref[2];
      else if (/^'.*'$/.test(part)) mapping.fallback = part.slice(1, -1);
      else throw new Error(`TF_VAR_${tfvar}: unsupported expression part ${part}`);
    }
    const previous = mappings.get(tfvar);
    if (previous && JSON.stringify(previous) !== JSON.stringify(mapping)) {
      throw new Error(`TF_VAR_${tfvar} is mapped differently in the plan and apply jobs`);
    }
    mappings.set(tfvar, mapping);
  }
  return mappings;
}

/** Collect `sensitive` and scalar `default` for each variable block in variables.tf. */
export function parseVariables(text) {
  const vars = new Map();
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const start = /^variable\s+"([^"]+)"\s*\{/.exec(lines[i]);
    if (!start) continue;
    const info = { sensitive: false, default: undefined };
    for (i++; i < lines.length && lines[i] !== "}"; i++) {
      if (/^ {2}sensitive\s*=\s*true\b/.test(lines[i])) info.sensitive = true;
      const def = /^ {2}default\s*=\s*(.*)$/.exec(lines[i]);
      if (def) info.default = parseScalar(def[1]);
    }
    vars.set(start[1], info);
  }
  return vars;
}

/** The R2 credentials and account id live in backend.tfvars, outside the plan's variables. */
export function parseBackend(text) {
  const pick = (key) => {
    const m = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, "m").exec(text);
    return m ? parseScalar(m[1]) : undefined;
  };
  const account = /https:\/\/([0-9a-f]+)\.r2\.cloudflarestorage\.com/.exec(text);
  return { accessKey: pick("access_key"), secretKey: pick("secret_key"), accountId: account?.[1] };
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

/**
 * Decide where each tfvars entry goes. Secrets win when the variable is marked
 * sensitive or the workflow only reads a secret; everything else becomes a
 * repository variable, which the workflow reads first.
 */
export function buildPlan({ tfvars, workflow, variables, backend }) {
  const entries = [];
  const errors = [];
  const warnings = [];

  for (const [tfvar, value] of tfvars) {
    const mapping = workflow.get(tfvar);
    const info = variables.get(tfvar) ?? { sensitive: false, default: undefined };
    if (!mapping) {
      if (value !== (info.default ?? "")) {
        errors.push(
          `${tfvar}: set locally but the workflow never reads it, so CI would use the default`
        );
      }
      continue;
    }
    if (/\$\{|%\{/.test(value)) {
      errors.push(`${tfvar}: contains a template sequence, which CI would pass through literally`);
      continue;
    }
    if (value === "") {
      if (mapping.fallback) {
        errors.push(`${tfvar}: empty locally but CI falls back to '${mapping.fallback}'`);
      }
      continue;
    }
    const asSecret = mapping.secrets && (info.sensitive || !mapping.vars);
    if (!asSecret && info.sensitive) {
      warnings.push(`${tfvar}: sensitive, but the workflow only reads a variable`);
    }
    entries.push({
      tfvar,
      kind: asSecret ? "secret" : "variable",
      name: asSecret ? mapping.secrets : mapping.vars,
      value,
    });
  }

  // Values left at their defaults locally must also come out the same in CI.
  for (const [tfvar, mapping] of workflow) {
    if (tfvars.has(tfvar)) continue;
    const local = variables.get(tfvar)?.default;
    const ci = mapping.fallback ?? "";
    if (local !== undefined && String(local) !== ci) {
      warnings.push(
        `${tfvar}: not in tfvars; local uses the default '${local}' but CI would use '${ci}'`
      );
    }
  }

  const push = (tfvar, name, value) => {
    if (value) entries.push({ tfvar, kind: "secret", name, value });
    else errors.push(`${tfvar}: missing from backend.tfvars`);
  };
  push("backend.access_key", "R2_ACCESS_KEY_ID", backend.accessKey);
  push("backend.secret_key", "R2_SECRET_ACCESS_KEY", backend.secretKey);
  const account = tfvars.get("cloudflare_account_id");
  if (backend.accountId && account && backend.accountId !== account) {
    errors.push("backend.tfvars endpoint account id differs from cloudflare_account_id");
  }

  const seen = new Map();
  for (const entry of entries) {
    const key = `${entry.kind}:${entry.name}`;
    if (seen.has(key) && seen.get(key) !== entry.value) {
      errors.push(`${entry.name}: two tfvars entries map to it with different values`);
    }
    seen.set(key, entry.value);
  }
  return { entries, errors, warnings };
}

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

function gh(args, input) {
  const result = spawnSync("gh", args, { input, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`gh ${args.slice(0, 3).join(" ")} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

function remoteState(repo) {
  const secrets = JSON.parse(gh(["secret", "list", "--repo", repo, "--json", "name,updatedAt"]));
  const variables = JSON.parse(gh(["variable", "list", "--repo", repo, "--json", "name,value"]));
  return {
    secrets: new Map(secrets.map((s) => [s.name, s.updatedAt])),
    variables: new Map(variables.map((v) => [v.name, v.value])),
  };
}

/** Compare one planned entry with what GitHub holds. */
export function entryStatus(entry, remote) {
  if (entry.kind === "variable") {
    if (!remote.variables.has(entry.name)) return "missing";
    return remote.variables.get(entry.name) === entry.value ? "match" : "differs";
  }
  // A variable with the same name shadows the secret (`vars.X || secrets.X`).
  if (remote.variables.has(entry.name)) return "shadowed";
  return remote.secrets.has(entry.name) ? "present" : "missing";
}

const display = (entry) =>
  entry.kind === "secret"
    ? `(${entry.value.length} chars, hidden)`
    : JSON.stringify(entry.value.length > 60 ? `${entry.value.slice(0, 57)}...` : entry.value);

function printPlan(plan, remote) {
  const rows = plan.entries.map((e) => [
    e.kind,
    e.name,
    e.tfvar,
    entryStatus(e, remote),
    display(e),
  ]);
  const widths = [8, 0, 0, 8].map((w, i) => Math.max(w, ...rows.map((r) => r[i].length)));
  for (const row of rows) {
    console.log(row.map((cell, i) => (i < 4 ? cell.padEnd(widths[i]) : cell)).join("  "));
  }
  console.log(
    `\n${plan.entries.filter((e) => e.kind === "secret").length} secrets, ` +
      `${plan.entries.filter((e) => e.kind === "variable").length} variables`
  );
  for (const w of plan.warnings) console.log(`warning: ${w}`);
  for (const e of plan.errors) console.log(`error:   ${e}`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { mode: "dry-run", only: null, repo: "Cheeli0/background-agents" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--apply") args.mode = "apply";
    else if (argv[i] === "--verify") args.mode = "verify";
    else if (argv[i] === "--only") args.only = new Set(argv[++i].split(","));
    else if (argv[i] === "--repo") args.repo = argv[++i];
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const plan = buildPlan({
    tfvars: parseTfvars(readFileSync(join(ENV_DIR, "terraform.tfvars"), "utf8")),
    workflow: parseWorkflow(readFileSync(WORKFLOW, "utf8")),
    variables: parseVariables(readFileSync(join(ENV_DIR, "variables.tf"), "utf8")),
    backend: parseBackend(readFileSync(join(ENV_DIR, "backend.tfvars"), "utf8")),
  });
  if (args.only) {
    plan.entries = plan.entries.filter((e) => args.only.has(e.name) || args.only.has(e.tfvar));
    const unknown = [...args.only].filter(
      (n) => !plan.entries.some((e) => e.name === n || e.tfvar === n)
    );
    if (unknown.length) throw new Error(`--only names not in the plan: ${unknown.join(", ")}`);
  }

  const remote = remoteState(args.repo);
  console.log(`Repository: ${args.repo}  mode: ${args.mode}\n`);
  printPlan(plan, remote);
  if (plan.errors.length) {
    console.log("\nFix the errors above first; nothing was changed.");
    process.exit(1);
  }

  if (args.mode === "apply") {
    console.log("");
    for (const entry of plan.entries) {
      gh([entry.kind, "set", entry.name, "--repo", args.repo], entry.value);
      console.log(`set ${entry.kind} ${entry.name}`);
    }
    console.log("\nRun with --verify to check the result.");
  }

  if (args.mode === "verify") {
    const bad = plan.entries.filter((e) => !["match", "present"].includes(entryStatus(e, remote)));
    for (const e of bad)
      console.log(`not applied: ${e.kind} ${e.name} (${entryStatus(e, remote)})`);
    console.log(bad.length ? `\n${bad.length} entries not applied.` : "\nAll entries applied.");
    process.exit(bad.length ? 1 : 0);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === join(process.argv[1])) {
  try {
    main();
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exit(1);
  }
}
