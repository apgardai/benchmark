import {existsSync, readFileSync} from "node:fs";
import path from "node:path";

const BENCHMARK_IDS = ["wellbeing", "csea"];

/** @typedef {{ id: string, label: string, description: string, resultsDir: string, scenariosFile: string, risksFile: string, default?: boolean }} BenchmarkDefinition */

/**
 * @param {string} [cwd]
 * @returns {{ benchmarks: Record<string, BenchmarkDefinition>, root: string }}
 */
export function loadBenchmarksRegistry(cwd = process.cwd()) {
  const root = findBenchmarkRoot(cwd);
  const registryPath = path.join(root, "data", "benchmarks.json");
  const raw = readFileSync(registryPath, "utf-8");
  const parsed = JSON.parse(raw);
  if (!parsed?.benchmarks || typeof parsed.benchmarks !== "object") {
    throw new Error(`Invalid benchmarks.json at ${registryPath}`);
  }
  return {benchmarks: parsed.benchmarks, root};
}

/**
 * @param {string} [cwd]
 * @returns {string}
 */
export function findBenchmarkRoot(cwd = process.cwd()) {
  let dir = cwd;
  while (true) {
    const candidate = path.join(dir, "data", "benchmarks.json");
    if (existsSync(candidate)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(
        `Could not find data/benchmarks.json in ${cwd} or any parent directory.`
      );
    }
    dir = parent;
  }
}

/**
 * @param {string} benchmarkId
 * @param {string} [cwd]
 * @returns {BenchmarkDefinition & { root: string, resultsDirPath: string, scenariosPath: string, risksPath: string }}
 */
export function resolveBenchmark(benchmarkId, cwd = process.cwd()) {
  const id = (benchmarkId || "").trim();
  const {benchmarks, root} = loadBenchmarksRegistry(cwd);
  const entry = benchmarks[id];
  if (!entry) {
    const available = Object.keys(benchmarks).sort().join(", ");
    throw new Error(`Unknown benchmark "${id}". Known benchmarks: ${available}`);
  }
  return {
    ...entry,
    root,
    resultsDirPath: path.join(root, "data", entry.resultsDir),
    scenariosPath: path.join(root, entry.scenariosFile),
    risksPath: path.join(root, entry.risksFile),
  };
}

/**
 * @param {string} [cwd]
 * @returns {string}
 */
export function defaultBenchmarkId(cwd = process.cwd()) {
  const {benchmarks} = loadBenchmarksRegistry(cwd);
  const explicit = Object.values(benchmarks).find(b => b.default);
  if (explicit?.id) {
    return explicit.id;
  }
  return BENCHMARK_IDS[0];
}

/**
 * @param {string} benchmarkId
 */
export function assertBenchmarkId(benchmarkId) {
  if (!BENCHMARK_IDS.includes(benchmarkId)) {
    throw new Error(`Invalid benchmark id "${benchmarkId}".`);
  }
}

export {BENCHMARK_IDS};
