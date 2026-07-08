import {memoize} from "@korabench/core";
import {existsSync, readFileSync} from "node:fs";
import {resolve} from "node:path";
import * as R from "remeda";
import * as v from "valibot";
import defaultRisks from "../../data/risks.json" with {type: "json"};
import {Risk} from "./risk.js";

function loadRisksData() {
  const override = process.env.BENCHMARK_RISKS_FILE?.trim();
  if (override) {
    const path = resolve(override);
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, "utf-8")) as unknown;
    }
  }
  return defaultRisks;
}

//
// Runtime model.
//

const VRiskCategory = v.object({
  id: v.string(),
  name: v.string(),
  risks: v.pipe(v.array(Risk.io), v.readonly()),
});

//
// API.
//

const listAll = memoize(() => {
  const type = v.pipe(v.array(VRiskCategory), v.readonly());
  return v.parse(type, loadRisksData());
});

function find(riskCategoryId: string) {
  const result = listAll().find(r => r.id === riskCategoryId);
  if (!result) {
    throw new Error("Risk category not found.");
  }

  return result;
}

function findAnyRisk(riskId: string) {
  return R.pipe(
    listAll(),
    R.flatMap(r => r.risks),
    R.find(r => r.id === riskId)
  );
}

function findRisk(riskCategory: RiskCategory, riskId: string) {
  const result = riskCategory.risks.find(r => r.id === riskId);
  if (!result) {
    throw new Error("Risk not found in category.");
  }

  return result;
}

//
// Exports.
//

export interface RiskCategory extends v.InferOutput<typeof VRiskCategory> {}

export const RiskCategory = {
  io: VRiskCategory,
  listAll,
  find,
  findAnyRisk,
  findRisk,
};
