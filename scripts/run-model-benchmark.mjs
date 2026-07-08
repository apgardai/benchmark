#!/usr/bin/env node
import {existsSync, readFileSync} from "node:fs";
import {mkdir, writeFile} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {spawn} from "node:child_process";
import {
  defaultBenchmarkId,
  resolveBenchmark,
} from "./lib/benchmark-config.mjs";
import {
  applyResultsMerge,
  restoreResultsFromMergeStaging,
  snapshotResultsForMerge,
} from "./lib/merge-model-results.mjs";
import {parseRunModelArgv} from "./lib/parse-run-model-argv.mjs";

function printUsage() {
  console.error(
    "Usage: yarn run:model <target-model> [judge-model] [user-model] [--benchmark wellbeing|csea] [--prompts <csv>] [--merge] [--input <path>]"
  );
}

function stripMergeFlag(args) {
  const merge = args.includes("--merge");
  return {merge, cliArgs: args.filter(a => a !== "--merge")};
}

function parseBenchmarkFromArgs(args) {
  const idx = args.indexOf("--benchmark");
  if (idx === -1 || idx + 1 >= args.length) {
    return {benchmarkId: defaultBenchmarkId(), cliArgs: args};
  }
  const benchmarkId = args[idx + 1].trim();
  const cliArgs = [...args.slice(0, idx), ...args.slice(idx + 2)];
  return {benchmarkId, cliArgs};
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

function hasInputFlag(args) {
  return args.some(a => a === "--input" || a === "-i");
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

const {judgeModel, userModel, extraArgs: parsedExtra} = parseRunModelArgv(
  argv.slice(1)
);
const {merge, cliArgs: mergeStrippedArgs} = stripMergeFlag(parsedExtra);
const {benchmarkId, cliArgs: benchmarkStrippedArgs} =
  parseBenchmarkFromArgs(mergeStrippedArgs);

let benchmark;
try {
  benchmark = resolveBenchmark(benchmarkId);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const {registry} = loadModelRegistry();
const judgeSlug = judgeModel ?? "gpt-5.2:high:limited";
const userSlug = userModel ?? "deepseek-v3.2";

assertKnownGatewayModel(registry, judgeSlug, "judge");
assertKnownGatewayModel(registry, userSlug, "user");
if (!targetModel.startsWith("custom-")) {
  assertKnownGatewayModel(registry, targetModel, "target");
}

const modelDir = sanitizeModelForPath(targetModel);
const outputDir = path.join(benchmark.resultsDirPath, modelDir);
const outputPath = path.join(outputDir, "results.json");
const runMetaPath = path.join(outputDir, "run-meta.json");
const prompts = parsePromptsFromArgs(benchmarkStrippedArgs);

const inputArgs = hasInputFlag(benchmarkStrippedArgs)
  ? []
  : ["-i", benchmark.scenariosPath];

await mkdir(outputDir, {recursive: true});

let mergeSnapshotted = false;
if (merge) {
  mergeSnapshotted = await snapshotResultsForMerge(outputDir);
  if (mergeSnapshotted) {
    console.log(
      `Merge enabled: keeping existing prompts other than [${prompts.join(", ")}] after this run.`
    );
  }
}

await writeFile(
  runMetaPath,
  `${JSON.stringify(
    {
      benchmark: benchmark.id,
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
  ...inputArgs,
  ...benchmarkStrippedArgs,
];

console.log(`Running ${benchmark.label} benchmark for "${targetModel}"`);
console.log(`Saving results to ${outputDir}`);

const child = spawn(process.execPath, cliArgs, {
  stdio: "inherit",
  cwd: process.cwd(),
  env: {
    ...process.env,
    BENCHMARK_ID: benchmark.id,
    BENCHMARK_RISKS_FILE: benchmark.risksPath,
  },
});

child.on("exit", code => {
  void (async () => {
    const exitCode = code ?? 1;
    try {
      const finishedAt = new Date().toISOString();
      const existing = JSON.parse(readFileSync(runMetaPath, "utf-8"));
      await writeFile(
        runMetaPath,
        `${JSON.stringify(
          {
            ...existing,
            finished_at: finishedAt,
            status: exitCode === 0 ? "completed" : "failed",
            exit_code: exitCode,
            merge,
          },
          null,
          2
        )}\n`
      );
    } catch {
      // Best-effort; results.json still holds final metadata when the run succeeds.
    }

    if (merge && mergeSnapshotted) {
      try {
        if (exitCode === 0) {
          const {testCount} = await applyResultsMerge(outputDir, prompts);
          console.log(
            `Merged run into ${outputDir} (${testCount} scenario files in archive).`
          );
        } else {
          await restoreResultsFromMergeStaging(outputDir);
          console.error(
            "Benchmark failed; restored previous results from merge staging."
          );
        }
      } catch (err) {
        console.error(
          `Merge failed: ${err instanceof Error ? err.message : String(err)}`
        );
        try {
          await restoreResultsFromMergeStaging(outputDir);
          console.error("Restored previous results from merge staging.");
        } catch {
          // ignore secondary failure
        }
        process.exit(1);
        return;
      }
    }

    process.exit(exitCode);
  })();
});
child.on("error", err => {
  console.error(`Failed to start benchmark run: ${err.message}`);
  process.exit(1);
});
