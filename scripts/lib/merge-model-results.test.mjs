import assert from "node:assert/strict";
import {
  mergeResultsJson,
  mergeTestResultEntries,
  normalizePromptValue,
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

console.log("merge-model-results.test.mjs: ok");
