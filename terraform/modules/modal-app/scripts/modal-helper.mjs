#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const MODAL_COMMAND_CANDIDATES =
  process.platform === "win32" ? ["modal.exe", "modal.cmd", "modal"] : ["modal"];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Error: ${name} environment variable is not set`);
  }
  return value;
}

function runModal(args, { allowFailure = false, cwd, extraEnv = {} } = {}) {
  const env = {
    ...process.env,
    ...extraEnv,
  };

  for (const command of MODAL_COMMAND_CANDIDATES) {
    const result = spawnSync(command, args, {
      encoding: "utf8",
      cwd,
      env,
    });

    if (result.error?.code === "ENOENT") {
      continue;
    }

    if (result.stdout) {
      process.stdout.write(result.stdout);
    }

    if (result.stderr) {
      process.stderr.write(result.stderr);
    }

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0 && !allowFailure) {
      throw new Error(`Modal command failed: ${command} ${args.join(" ")}`);
    }

    return result;
  }

  throw new Error("Error: Could not find the `modal` CLI in PATH");
}

function validateSecretName(secretName) {
  if (!/^[a-zA-Z0-9_-]+$/.test(secretName)) {
    throw new Error(
      `Error: Invalid secret name '${secretName}'. Only alphanumeric, underscore, and hyphen allowed.`
    );
  }
}

function validateEnvKey(key) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
    throw new Error(`Error: Invalid key name '${key}'. Must be a valid environment variable name.`);
  }
}

function createSecrets() {
  console.log("Creating/updating Modal secrets...");

  const modalTokenId = requireEnv("MODAL_TOKEN_ID");
  const modalTokenSecret = requireEnv("MODAL_TOKEN_SECRET");
  const secretsJson = requireEnv("SECRETS_JSON");

  let secrets;
  try {
    secrets = JSON.parse(secretsJson);
  } catch {
    throw new Error("Error: SECRETS_JSON is not valid JSON");
  }

  if (!Array.isArray(secrets)) {
    throw new Error("Error: SECRETS_JSON must be a JSON array");
  }

  let hasFailures = false;

  for (const secret of secrets) {
    const secretName = secret?.name;
    const values = secret?.values;

    if (typeof secretName !== "string") {
      throw new Error("Error: Each secret must include a string `name`");
    }

    if (!values || typeof values !== "object" || Array.isArray(values)) {
      throw new Error(`Error: Secret '${secretName}' must include a key/value map in \`values\``);
    }

    validateSecretName(secretName);
    console.log(`Processing secret: ${secretName}`);

    const secretArgs = ["secret", "create", secretName];

    for (const [key, value] of Object.entries(values)) {
      validateEnvKey(key);
      secretArgs.push(`${key}=${String(value)}`);
    }

    secretArgs.push("--force");

    const result = runModal(secretArgs, {
      allowFailure: true,
      extraEnv: {
        MODAL_TOKEN_ID: modalTokenId,
        MODAL_TOKEN_SECRET: modalTokenSecret,
      },
    });

    if (result.status === 0) {
      console.log(`Secret ${secretName} created/updated successfully`);
    } else {
      hasFailures = true;
      console.warn(`Warning: Failed to create secret ${secretName}`);
    }
  }

  if (hasFailures) {
    throw new Error("Error: One or more Modal secrets failed to create or update");
  }

  console.log("All Modal secrets processed successfully");
}

function createVolume(volumeName) {
  if (!volumeName) {
    throw new Error("Error: Volume name argument is required");
  }

  const result = runModal(["volume", "create", volumeName], {
    allowFailure: true,
  });

  if (result.status === 0) {
    return;
  }

  const combinedOutput = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.toLowerCase();
  if (combinedOutput.includes("already exists")) {
    console.log(`Volume ${volumeName} already exists`);
    return;
  }

  throw new Error(`Error: Failed to create Modal volume ${volumeName}`);
}

function deploy() {
  const modalTokenId = requireEnv("MODAL_TOKEN_ID");
  const modalTokenSecret = requireEnv("MODAL_TOKEN_SECRET");
  const appName = requireEnv("APP_NAME");
  const deployPath = requireEnv("DEPLOY_PATH");
  const deployModule = requireEnv("DEPLOY_MODULE");

  console.log(`Deploying Modal app: ${appName}`);
  console.log(`Deploy path: ${deployPath}`);
  console.log(`Deploy module: ${deployModule}`);

  const extraEnv = {
    MODAL_TOKEN_ID: modalTokenId,
    MODAL_TOKEN_SECRET: modalTokenSecret,
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
  };

  let modalArgs;
  if (deployModule === "deploy") {
    modalArgs = ["deploy", "deploy.py"];
  } else if (deployModule === "src") {
    modalArgs = ["deploy", "-m", "src"];
  } else {
    modalArgs = ["deploy", deployModule];
  }

  const result = runModal(modalArgs, {
    cwd: deployPath,
    extraEnv,
  });

  if (result.status !== 0) {
    throw new Error(`Error: Modal deployment failed for ${appName}`);
  }

  console.log(`Modal app ${appName} deployed successfully`);
}

function printAppInfo(appName) {
  if (!appName) {
    throw new Error("Error: App name argument is required");
  }

  process.stdout.write(`${JSON.stringify({ app_name: appName, status: "deployed" })}\n`);
}

const command = process.argv[2];

try {
  switch (command) {
    case "create-secrets":
      createSecrets();
      break;
    case "create-volume":
      createVolume(process.argv[3]);
      break;
    case "deploy":
      deploy();
      break;
    case "app-info":
      printAppInfo(process.argv[3]);
      break;
    default:
      fail(
        `Error: Unsupported modal helper command '${command}'. Expected one of create-secrets, create-volume, deploy, app-info.`
      );
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
