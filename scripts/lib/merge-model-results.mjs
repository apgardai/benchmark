import {createWriteStream, existsSync} from "node:fs";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import {createRequire} from "node:module";
import path from "node:path";
import {fileURLToPath} from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(
  path.join(__dirname, "../../packages/cli/package.json")
);
const archiver = require("archiver");

export const MERGE_STAGING_DIRNAME = ".merge-staging";

/**
 * @param {string | null | undefined} prompt
 */
export function normalizePromptValue(prompt) {
  const p = (prompt ?? "default").toString().trim().toLowerCase();
  return p === "child" ? "child" : "default";
}

/**
 * @param {Record<string, unknown> | null | undefined} doc
 * @param {readonly string[]} replacePrompts
 */
export function mergeResultsJson(doc, incoming, replacePrompts) {
  const replaceSet = new Set(replacePrompts.map(normalizePromptValue));
  const existing = doc ?? {};
  const next = incoming ?? {};

  /** @type {Array<Record<string, unknown>>} */
  const existingScores = Array.isArray(existing.scores) ? existing.scores : [];
  /** @type {Array<Record<string, unknown>>} */
  const incomingScores = Array.isArray(next.scores) ? next.scores : [];

  const kept = existingScores.filter(
    row =>
      row &&
      typeof row === "object" &&
      !replaceSet.has(normalizePromptValue(/** @type {{ prompt?: string }} */ (row).prompt))
  );
  const replaced = incomingScores.filter(
    row =>
      row &&
      typeof row === "object" &&
      replaceSet.has(normalizePromptValue(/** @type {{ prompt?: string }} */ (row).prompt))
  );

  const prompts = [
    ...new Set([
      ...(Array.isArray(existing.prompts) ? existing.prompts : []).map(String),
      ...(Array.isArray(next.prompts) ? next.prompts : []).map(String),
    ]),
  ];

  return {
    ...existing,
    ...next,
    prompts,
    scores: [...kept, ...replaced],
  };
}

/**
 * @param {Record<string, unknown>} record
 */
function testResultPrompt(record) {
  return normalizePromptValue(
    typeof record.prompt === "string" ? record.prompt : "default"
  );
}

/**
 * @param {Array<{ fileName: string, record: Record<string, unknown> }>} existing
 * @param {Array<{ fileName: string, record: Record<string, unknown> }>} incoming
 * @param {readonly string[]} replacePrompts
 */
export function mergeTestResultEntries(existing, incoming, replacePrompts) {
  const replaceSet = new Set(replacePrompts.map(normalizePromptValue));
  const kept = existing.filter(entry => !replaceSet.has(testResultPrompt(entry.record)));
  const replaced = incoming.filter(entry =>
    replaceSet.has(testResultPrompt(entry.record))
  );
  return [...kept, ...replaced];
}

/**
 * @param {string} dir
 */
async function readTestResultsDir(dir) {
  /** @type {Array<{ fileName: string, record: Record<string, unknown> }>} */
  const out = [];
  if (!existsSync(dir)) {
    return out;
  }
  const names = await readdir(dir);
  for (const fileName of names) {
    if (!fileName.endsWith(".json")) {
      continue;
    }
    const raw = await readFile(path.join(dir, fileName), "utf-8");
    const record = JSON.parse(raw);
    if (record && typeof record === "object") {
      out.push({fileName, record: /** @type {Record<string, unknown>} */ (record)});
    }
  }
  return out;
}

/**
 * @param {string} zipPath
 */
export async function readTestResultsFromZip(zipPath) {
  /** @type {Array<{ fileName: string, record: Record<string, unknown> }>} */
  const out = [];
  if (!existsSync(zipPath)) {
    return out;
  }

  const {spawn} = await import("node:child_process");

  const list = await new Promise((resolve, reject) => {
    const proc = spawn("unzip", ["-Z1", zipPath]);
    let stdout = "";
    proc.stdout.on("data", d => {
      stdout += d.toString();
    });
    proc.on("error", reject);
    proc.on("close", code => {
      if (code !== 0) {
        reject(new Error(`unzip -Z1 failed for ${zipPath} (exit ${code})`));
        return;
      }
      resolve(
        stdout
          .split("\n")
          .map(s => s.trim())
          .filter(Boolean)
      );
    });
  });

  for (const member of list) {
    const parts = member.split("/").filter(Boolean);
    if (parts.length < 2 || parts[parts.length - 2].toLowerCase() !== "testresults") {
      continue;
    }
    const fileName = parts[parts.length - 1];
    if (!fileName.endsWith(".json")) {
      continue;
    }
    const raw = await new Promise((resolve, reject) => {
      const proc = spawn("unzip", ["-p", zipPath, member]);
      let stdout = "";
      proc.stdout.on("data", d => {
        stdout += d.toString();
      });
      proc.on("error", reject);
      proc.on("close", code => {
        if (code !== 0) {
          reject(new Error(`unzip -p failed for ${member} in ${zipPath}`));
          return;
        }
        resolve(stdout);
      });
    });
    const record = JSON.parse(raw);
    if (record && typeof record === "object") {
      out.push({fileName, record: /** @type {Record<string, unknown>} */ (record)});
    }
  }
  return out;
}

/**
 * @param {string} outputDir
 */
export function resolveResultsArtifacts(outputDir) {
  const candidates = [
    {
      resultsJson: path.join(outputDir, "results.json"),
      resultsZip: path.join(outputDir, "results.zip"),
      testResultsDir: path.join(outputDir, "testResults"),
    },
    {
      resultsJson: path.join(outputDir, "results", "results.json"),
      resultsZip: path.join(outputDir, "results", "results.zip"),
      testResultsDir: path.join(outputDir, "results", "testResults"),
    },
  ];
  for (const c of candidates) {
    if (existsSync(c.resultsJson)) {
      return c;
    }
  }
  return candidates[0];
}

/**
 * @param {string} outputDir
 */
export function mergeStagingDir(outputDir) {
  return path.join(outputDir, MERGE_STAGING_DIRNAME);
}

/**
 * @param {string} outputDir
 */
export async function snapshotResultsForMerge(outputDir) {
  const artifacts = resolveResultsArtifacts(outputDir);
  const staging = mergeStagingDir(outputDir);
  await rm(staging, {recursive: true, force: true});
  await mkdir(staging, {recursive: true});

  let snapshotted = false;
  if (existsSync(artifacts.resultsJson)) {
    await copyFile(
      artifacts.resultsJson,
      path.join(staging, "previous-results.json")
    );
    snapshotted = true;
  }
  if (existsSync(artifacts.resultsZip)) {
    await copyFile(artifacts.resultsZip, path.join(staging, "previous-results.zip"));
    snapshotted = true;
  } else if (existsSync(artifacts.testResultsDir)) {
    const dest = path.join(staging, "previous-testResults");
    await mkdir(dest, {recursive: true});
    const names = await readdir(artifacts.testResultsDir);
    for (const name of names) {
      if (!name.endsWith(".json")) {
        continue;
      }
      await copyFile(
        path.join(artifacts.testResultsDir, name),
        path.join(dest, name)
      );
    }
    snapshotted = true;
  }

  return snapshotted;
}

/**
 * @param {string} outputDir
 */
export async function restoreResultsFromMergeStaging(outputDir) {
  const staging = mergeStagingDir(outputDir);
  const artifacts = resolveResultsArtifacts(outputDir);
  const previousJson = path.join(staging, "previous-results.json");
  const previousZip = path.join(staging, "previous-results.zip");
  const previousTestResults = path.join(staging, "previous-testResults");

  if (existsSync(previousJson)) {
    await mkdir(path.dirname(artifacts.resultsJson), {recursive: true});
    await copyFile(previousJson, artifacts.resultsJson);
  }
  if (existsSync(previousZip)) {
    await mkdir(path.dirname(artifacts.resultsZip), {recursive: true});
    await copyFile(previousZip, artifacts.resultsZip);
  } else if (existsSync(previousTestResults)) {
    await mkdir(artifacts.testResultsDir, {recursive: true});
    const names = await readdir(previousTestResults);
    for (const name of names) {
      if (!name.endsWith(".json")) {
        continue;
      }
      await copyFile(
        path.join(previousTestResults, name),
        path.join(artifacts.testResultsDir, name)
      );
    }
  }
}

/**
 * @param {string} resultsJsonPath
 * @param {string} testResultsDir
 * @param {Array<{ fileName: string, record: Record<string, unknown> }>} entries
 * @param {string} zipPath
 */
export async function rebuildResultsZip(
  resultsJsonPath,
  testResultsDir,
  entries,
  zipPath
) {
  await mkdir(testResultsDir, {recursive: true});
  const names = await readdir(testResultsDir).catch(() => []);
  for (const name of names) {
    if (name.endsWith(".json")) {
      await rm(path.join(testResultsDir, name));
    }
  }
  for (const {fileName, record} of entries) {
    await writeFile(
      path.join(testResultsDir, fileName),
      `${JSON.stringify(record, null, 2)}\n`
    );
  }

  await mkdir(path.dirname(zipPath), {recursive: true});
  const output = createWriteStream(zipPath);
  const archive = archiver("zip", {zlib: {level: 9}});
  const done = new Promise((resolve, reject) => {
    output.on("close", resolve);
    archive.on("error", reject);
  });
  archive.pipe(output);
  archive.directory(testResultsDir, "testResults");
  archive.file(resultsJsonPath, {name: path.basename(resultsJsonPath)});
  await archive.finalize();
  await done;
}

/**
 * @param {string} outputDir
 * @param {readonly string[]} replacePrompts
 */
export async function applyResultsMerge(outputDir, replacePrompts) {
  const artifacts = resolveResultsArtifacts(outputDir);
  const staging = mergeStagingDir(outputDir);
  const previousJsonPath = path.join(staging, "previous-results.json");
  const previousZipPath = path.join(staging, "previous-results.zip");
  const previousTestResultsDir = path.join(staging, "previous-testResults");

  if (!existsSync(artifacts.resultsJson)) {
    throw new Error(`Missing new results.json under ${outputDir}`);
  }

  const incomingRaw = await readFile(artifacts.resultsJson, "utf-8");
  const incoming = JSON.parse(incomingRaw);

  let existing = null;
  if (existsSync(previousJsonPath)) {
    existing = JSON.parse(await readFile(previousJsonPath, "utf-8"));
  }

  const merged =
    existing != null
      ? mergeResultsJson(existing, incoming, replacePrompts)
      : incoming;

  await mkdir(path.dirname(artifacts.resultsJson), {recursive: true});
  await writeFile(artifacts.resultsJson, `${JSON.stringify(merged, null, 2)}\n`);

  /** @type {Array<{ fileName: string, record: Record<string, unknown> }>} */
  let existingEntries = [];
  if (existsSync(previousZipPath)) {
    existingEntries = await readTestResultsFromZip(previousZipPath);
  } else if (existsSync(previousTestResultsDir)) {
    existingEntries = await readTestResultsDir(previousTestResultsDir);
  }

  /** @type {Array<{ fileName: string, record: Record<string, unknown> }>} */
  let incomingEntries = [];
  if (existsSync(artifacts.resultsZip)) {
    incomingEntries = await readTestResultsFromZip(artifacts.resultsZip);
  } else {
    incomingEntries = await readTestResultsDir(artifacts.testResultsDir);
  }

  const mergedEntries = mergeTestResultEntries(
    existingEntries,
    incomingEntries,
    replacePrompts
  );

  const testResultsDir =
    artifacts.testResultsDir ??
    path.join(path.dirname(artifacts.resultsJson), "testResults");

  await rebuildResultsZip(
    artifacts.resultsJson,
    testResultsDir,
    mergedEntries,
    artifacts.resultsZip
  );

  const topLevelJson = path.join(outputDir, "results.json");
  if (artifacts.resultsJson !== topLevelJson) {
    await writeFile(topLevelJson, `${JSON.stringify(merged, null, 2)}\n`);
  }
  const topLevelZip = path.join(outputDir, "results.zip");
  if (artifacts.resultsZip !== topLevelZip && existsSync(artifacts.resultsZip)) {
    await copyFile(artifacts.resultsZip, topLevelZip);
  }

  await rm(staging, {recursive: true, force: true});
  return {merged, testCount: mergedEntries.length};
}
