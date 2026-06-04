import assert from "node:assert/strict";
import {mkdtemp, mkdir, rm, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  canonicalResultsArtifacts,
  mergeResultsJson,
  mergeTestResultEntries,
  normalizePromptValue,
  readResultsJsonDocument,
  snapshotResultsForMerge,
} from "./merge-model-results.mjs";

assert.equal(normalizePromptValue("child"), "child");
assert.equal(normalizePromptValue(undefined), "default");

const existing = {
  target: "gpt-4o",
  prompts: ["default"],
  scores: [
    {
      riskCategoryId: "a",
      riskId: "b",
      ageRange: "10to12",
      prompt: "default",
      sums: {al: 1, as: [1, 0, 0]},
    },
  ],
};

const childOnly = {
  target: "gpt-4o",
  prompts: ["child"],
  scores: [
    {
      riskCategoryId: "a",
      riskId: "b",
      ageRange: "10to12",
      prompt: "child",
      sums: {al: 1, as: [0, 1, 0]},
    },
  ],
};

const merged = mergeResultsJson(existing, childOnly, ["child"]);
assert.deepEqual(merged.prompts, ["default", "child"]);
assert.equal(merged.scores.length, 2);
assert.equal(merged.scores[0].prompt, "default");
assert.equal(merged.scores[1].prompt, "child");

const replaced = mergeResultsJson(
  {
    prompts: ["default", "child"],
    scores: [
      {riskCategoryId: "a", riskId: "b", ageRange: "10to12", prompt: "default", sums: {al: 1, as: [1, 0, 0]}},
      {riskCategoryId: "a", riskId: "b", ageRange: "10to12", prompt: "child", sums: {al: 1, as: [0, 0, 1]}},
    ],
  },
  {
    prompts: ["child"],
    scores: [
      {riskCategoryId: "a", riskId: "b", ageRange: "10to12", prompt: "child", sums: {al: 1, as: [0, 1, 0]}},
    ],
  },
  ["child"]
);
assert.equal(replaced.scores.length, 2);
assert.equal(replaced.scores.find(s => s.prompt === "child").sums.as[1], 1);

const files = mergeTestResultEntries(
  [{fileName: "a.json", record: {prompt: "default"}}, {fileName: "b.json", record: {prompt: "child"}}],
  [{fileName: "c.json", record: {prompt: "child"}}],
  ["child"]
);
assert.equal(files.length, 2);
assert.ok(files.some(f => f.fileName === "a.json"));
assert.ok(files.some(f => f.fileName === "c.json"));
assert.ok(!files.some(f => f.fileName === "b.json"));

const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "merge-test-"));
try {
  const outputDir = path.join(tmpRoot, "grok");
  await mkdir(path.join(outputDir, "results"), {recursive: true});
  await writeFile(path.join(outputDir, "results.json"), "");
  await writeFile(
    path.join(outputDir, "results", "results.json"),
    `${JSON.stringify({target: "x", prompts: ["default"], scores: []}, null, 2)}\n`
  );

  const snapshotted = await snapshotResultsForMerge(outputDir);
  assert.equal(snapshotted, true);
  const previous = await readResultsJsonDocument(
    path.join(outputDir, ".merge-staging", "previous-results.json")
  );
  assert.equal(previous?.target, "x");

  const canonical = canonicalResultsArtifacts(outputDir);
  assert.equal(canonical.resultsJson, path.join(outputDir, "results.json"));
} finally {
  await rm(tmpRoot, {recursive: true, force: true});
}

console.log("merge-model-results.test.mjs: ok");
