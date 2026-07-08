import assert from "node:assert/strict";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  defaultBenchmarkId,
  loadBenchmarksRegistry,
  resolveBenchmark,
} from "./benchmark-config.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const benchmarkRoot = path.resolve(here, "../..");

const {benchmarks} = loadBenchmarksRegistry(benchmarkRoot);
assert.ok(benchmarks.wellbeing);
assert.ok(benchmarks.csea);
assert.equal(defaultBenchmarkId(benchmarkRoot), "wellbeing");

const wellbeing = resolveBenchmark("wellbeing", benchmarkRoot);
assert.equal(wellbeing.resultsDir, "model-results");
assert.ok(wellbeing.risksPath.endsWith("risks-wellbeing.json"));

const csea = resolveBenchmark("csea", benchmarkRoot);
assert.equal(csea.resultsDir, "csea-model-results");
assert.ok(csea.scenariosPath.endsWith("data/scenarios.jsonl"));

console.log("benchmark-config.test.mjs: ok");
