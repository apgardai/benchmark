import assert from "node:assert/strict";
import {parseRunModelArgv} from "./parse-run-model-argv.mjs";

assert.deepEqual(parseRunModelArgv(["--prompts", "default,child"]), {
  judgeModel: undefined,
  userModel: undefined,
  extraArgs: ["--prompts", "default,child"],
});

assert.deepEqual(
  parseRunModelArgv([
    "gpt-5.2:high:limited",
    "deepseek-v3.2",
    "--prompts",
    "default,child",
  ]),
  {
    judgeModel: "gpt-5.2:high:limited",
    userModel: "deepseek-v3.2",
    extraArgs: ["--prompts", "default,child"],
  }
);

assert.deepEqual(parseRunModelArgv(["--input", "data/scenarios.jsonl"]), {
  judgeModel: undefined,
  userModel: undefined,
  extraArgs: ["--input", "data/scenarios.jsonl"],
});

console.log("parse-run-model-argv.test.mjs: ok");
