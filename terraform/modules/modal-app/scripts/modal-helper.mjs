#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import console from "node:console";
import process from "node:process";
import { pathToFileURL } from "node:url";

const UV_COMMANDS = process.platform === "win32" ? ["uv.exe", "uv.cmd", "uv"] : ["uv"];
const SECRET_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
const ENVIRONMENT_KEY_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function requireEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} environment variable is not set`);
  return value;
}

export function parseSecrets(value) {
  let secrets;
  try {
    secrets = JSON.parse(value);
  } catch {
    throw new Error("SECRETS_JSON is not valid JSON");
  }
  if (!Array.isArray(secrets)) throw new Error("SECRETS_JSON must be a JSON array");

  return secrets.map((secret) => {
    if (!SECRET_NAME_PATTERN.test(secret?.name ?? "")) {
      throw new Error(`Invalid secret name '${secret?.name ?? ""}'`);
    }
    if (!secret.values || typeof secret.values !== "object" || Array.isArray(secret.values)) {
      throw new Error(`Secret '${secret.name}' must contain a values object`);
    }
    for (const key of Object.keys(secret.values)) {
      if (!ENVIRONMENT_KEY_PATTERN.test(key)) throw new Error(`Invalid key name '${key}'`);
    }
    return secret;
  });
}

export function buildSecretSteps(secrets, deployPath) {
  return secrets.map((secret) => ({
    label: `secret ${secret.name}`,
    args: [
      "run",
      "--directory",
      deployPath,
      "modal",
      "secret",
      "create",
      secret.name,
      ...Object.entries(secret.values).map(([key, value]) => `${key}=${String(value)}`),
      "--force",
    ],
  }));
}

export function buildDeploySteps(deployModule) {
  const steps = [{ label: "dependency sync", args: ["sync", "--frozen"] }];
  if (deployModule === "deploy" || deployModule === "src") {
    steps.push({
      label: "sandbox image build",
      args: ["run", "python", "deploy.py", "--build-sandbox-image"],
    });
  }
  const target =
    deployModule === "deploy"
      ? ["deploy.py"]
      : deployModule === "src"
        ? ["-m", "src"]
        : [deployModule];
  steps.push({ label: "Modal deployment", args: ["run", "modal", "deploy", ...target] });
  return steps;
}

function runUv(args, options = {}) {
  for (const command of UV_COMMANDS) {
    const result = spawnSync(command, args, {
      cwd: options.cwd,
      env: process.env,
      encoding: "utf8",
      stdio: "inherit",
    });
    if (result.error?.code === "ENOENT") continue;
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`${options.label ?? "uv command"} failed with status ${result.status}`);
    }
    return;
  }
  throw new Error("Could not find the uv CLI in PATH");
}

function validateCommonEnvironment() {
  requireEnvironment("MODAL_TOKEN_ID");
  requireEnvironment("MODAL_TOKEN_SECRET");
  requireEnvironment("MODAL_ENVIRONMENT");
}

function createSecrets() {
  validateCommonEnvironment();
  const deployPath = requireEnvironment("DEPLOY_PATH");
  const secrets = parseSecrets(requireEnvironment("SECRETS_JSON"));
  for (const step of buildSecretSteps(secrets, deployPath)) runUv(step.args, step);
}

function deploy() {
  validateCommonEnvironment();
  const appName = requireEnvironment("APP_NAME");
  const deployPath = requireEnvironment("DEPLOY_PATH");
  const deployModule = requireEnvironment("DEPLOY_MODULE");
  console.log(`Deploying Modal app ${appName} in environment ${process.env.MODAL_ENVIRONMENT}`);
  for (const step of buildDeploySteps(deployModule)) {
    runUv(step.args, { ...step, cwd: deployPath });
  }
}

function appInfo(appName) {
  if (!appName) throw new Error("App name argument is required");
  process.stdout.write(`${JSON.stringify({ app_name: appName, status: "deployed" })}\n`);
}

function main() {
  const command = process.argv[2];
  if (command === "create-secrets") createSecrets();
  else if (command === "deploy") deploy();
  else if (command === "app-info") appInfo(process.argv[3]);
  else throw new Error(`Unsupported Modal helper command '${command ?? ""}'`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
