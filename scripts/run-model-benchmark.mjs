#!/usr/bin/env node
import {existsSync, readFileSync} from "node:fs";
import {mkdir} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {spawn} from "node:child_process";

function printUsage() {
  console.error(
    "Usage: yarn run:model <target-model> [judge-model] [user-model] [--prompts <csv>] [--input <path>]"
  );
}

function sanitizeModelForPath(model) {
  return model
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "model";
}

function findModelsJsonPath() {
  let dir = process.cwd();
  while (true) {
    const candidate = path.join(dir, "models.json");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(
        `Could not find models.json in ${process.cwd()} or any parent directory.`
      );
    }
    dir = parent;
  }
}

function loadModelRegistry() {
  const modelsPath = findModelsJsonPath();
  const raw = readFileSync(modelsPath, "utf-8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid models.json at ${modelsPath}`);
  }
  return {modelsPath, registry: /** @type {Record<string, unknown>} */ (parsed)};
}

/**
 * @param {Record<string, unknown>} registry
 * @param {string} slug
 * @param {string} roleLabel
 */
function assertKnownGatewayModel(registry, slug, roleLabel) {
  if (!registry[slug]) {
    const available = Object.keys(registry).sort().join(", ");
    console.error(
      `Unknown ${roleLabel} model "${slug}". Known slugs in models.json: ${available}`
    );
    process.exit(1);
  }
}

const [, , ...argv] = process.argv;
const targetModel = argv[0]?.trim();
if (!targetModel) {
  printUsage();
  process.exit(1);
}

const judgeModel = argv[1]?.startsWith("--") ? undefined : argv[1];
const userModel = argv[2]?.startsWith("--") ? undefined : argv[2];
const extraArgsStart = judgeModel ? (userModel ? 3 : 2) : 1;
const extraArgs = argv.slice(extraArgsStart);

const {registry} = loadModelRegistry();
const judgeSlug = judgeModel ?? "gpt-5.2:high:limited";
const userSlug = userModel ?? "deepseek-v3.2";

assertKnownGatewayModel(registry, judgeSlug, "judge");
assertKnownGatewayModel(registry, userSlug, "user");
if (!targetModel.startsWith("custom-")) {
  assertKnownGatewayModel(registry, targetModel, "target");
}

const modelDir = sanitizeModelForPath(targetModel);
const outputDir = path.join("data", "model-results", modelDir);
const outputPath = path.join(outputDir, "results.json");

await mkdir(outputDir, {recursive: true});

const cliArgs = [
  "--env-file=.env",
  "./packages/cli/build/src/cli.js",
  "run",
  targetModel,
  judgeModel ?? "gpt-5.2:high:limited",
  userModel ?? "deepseek-v3.2",
  "-o",
  outputPath,
  ...extraArgs,
];

console.log(`Running benchmark for "${targetModel}"`);
console.log(`Saving results to ${outputDir}`);

const child = spawn(process.execPath, cliArgs, {
  stdio: "inherit",
  cwd: process.cwd(),
});

child.on("exit", code => process.exit(code ?? 1));
child.on("error", err => {
  console.error(`Failed to start benchmark run: ${err.message}`);
  process.exit(1);
});
