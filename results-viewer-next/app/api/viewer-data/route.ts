import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

type Score = {
  riskCategoryId: string;
  riskId: string;
  ageRange: string;
  prompt: string;
  sums: {
    al: number;
    as: [number, number, number];
    an: [number, number, number, number];
    eh: [number, number, number, number];
    hr: [number, number, number, number];
  };
};

type ViewerScenario = {
  file: string;
  id: string;
  prompt: string;
  riskCategoryId: string;
  riskCategoryName: string;
  riskId: string;
  riskName: string;
  ageRange: string;
  scenarioTitle: string;
  narrative: string;
  assessmentReasons: string;
  safetyGrade: string;
  messages: Array<{ role: string; content: string }>;
};

function safeJsonParse(raw: string) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function readJson(filePath: string) {
  const raw = await fs.readFile(filePath, "utf8");
  return safeJsonParse(raw);
}

export async function GET() {
  const benchmarkRoot = path.resolve(process.cwd(), "..");
  // Use archived-results so benchmark CLI runs don't overwrite viewer data
  const archivedDir = path.join(benchmarkRoot, "results-viewer", "archived-results");
  const resultsPath = path.join(archivedDir, "results.json");
  const testResultsDir = path.join(archivedDir, "testResults");
  const risksPath = path.join(benchmarkRoot, "packages", "benchmark", "data", "risks.json");

  const [resultsJson, risksJson] = await Promise.all([
    readJson(resultsPath),
    readJson(risksPath),
  ]);

  const categoryMap = new Map<string, string>();
  const riskMap = new Map<string, string>();
  for (const c of risksJson || []) {
    if (!c?.id) continue;
    categoryMap.set(c.id, c.name || c.id);
    for (const r of c.risks || []) {
      if (!r?.id) continue;
      riskMap.set(`${c.id}:${r.id}`, r.name || r.id);
    }
  }

  let files: string[] = [];
  try {
    files = (await fs.readdir(testResultsDir)).filter((f) => f.endsWith(".json"));
  } catch {
    files = [];
  }

  const scenarios: ViewerScenario[] = [];
  for (const file of files) {
    const parsed = await readJson(path.join(testResultsDir, file));
    if (!parsed) continue;
    const scenario = parsed.scenario || {};
    const seed = scenario.seed || {};
    const assessment = parsed.assessment || {};
    const key = `${seed.riskCategoryId || ""}:${seed.riskId || ""}`;
    scenarios.push({
      file,
      id: seed.id || file,
      prompt: parsed.prompt || "default",
      riskCategoryId: seed.riskCategoryId || "",
      riskCategoryName: categoryMap.get(seed.riskCategoryId || "") || seed.riskCategoryId || "",
      riskId: seed.riskId || "",
      riskName: riskMap.get(key) || seed.riskId || "",
      ageRange: seed.ageRange || "",
      scenarioTitle: scenario.shortTitle || seed.shortTitle || "Untitled scenario",
      narrative: scenario.narrative || "",
      assessmentReasons: assessment.reasons || "",
      safetyGrade: assessment.grade || "",
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
    });
  }

  const scores: Score[] = Array.isArray(resultsJson?.scores) ? resultsJson.scores : [];

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    summary: {
      target: resultsJson?.target || "",
      judge: resultsJson?.judge || "",
      user: resultsJson?.user || "",
      prompts: resultsJson?.prompts || [],
      scores,
    },
    scenarios,
  });
}

