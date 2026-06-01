#!/usr/bin/env node
import {existsSync, readFileSync} from "node:fs";
import {mkdir, writeFile} from "node:fs/promises";
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
function parsePromptsFromArgs(args) {
  const idx = args.indexOf("--prompts");
  if (idx === -1 || idx + 1 >= args.length) {
    return ["default"];
  }
  const parts = args[idx + 1]
    .split(",")
    .map(s => s.trim())
    .filter(s => s.length > 0);
  return parts.length > 0 ? parts : ["default"];
}

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
const runMetaPath = path.join(outputDir, "run-meta.json");
const prompts = parsePromptsFromArgs(extraArgs);

await mkdir(outputDir, {recursive: true});

await writeFile(
  runMetaPath,
  `${JSON.stringify(
    {
      target_model: targetModel,
      judge_model: judgeSlug,
      user_model: userSlug,
      prompts,
      started_at: new Date().toISOString(),
    },
    null,
    2
  )}\n`
);

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

child.on("exit", code => {
  void (async () => {
    try {
      const finishedAt = new Date().toISOString();
      const existing = JSON.parse(readFileSync(runMetaPath, "utf-8"));
      await writeFile(
        runMetaPath,
        `${JSON.stringify(
          {
            ...existing,
            finished_at: finishedAt,
            status: code === 0 ? "completed" : "failed",
            exit_code: code ?? 1,
          },
          null,
          2
        )}\n`
      );
    } catch {
      // Best-effort; results.json still holds final metadata when the run succeeds.
    }
    process.exit(code ?? 1);
  })();
});
child.on("error", err => {
  console.error(`Failed to start benchmark run: ${err.message}`);
  process.exit(1);
});
