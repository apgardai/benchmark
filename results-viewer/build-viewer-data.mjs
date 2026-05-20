import fs from "node:fs";
import path from "node:path";

const rootDir = path.resolve(process.cwd());
const viewerRoot = path.join(rootDir, "results-viewer");
// Aggregate scores: stable archived run summary (not overwritten by CLI)
const archivedDir = path.join(viewerRoot, "archived-results");
const resultsPath = path.join(archivedDir, "results.json");
// Per-scenario JSON: prefer results-viewer/testResults; fall back to archived copy
const testResultsDirTop = path.join(viewerRoot, "testResults");
const testResultsDirArchived = path.join(archivedDir, "testResults");
const risksPath = path.join(rootDir, "packages", "benchmark", "data", "risks.json");
const outDir = path.join(rootDir, "results-viewer", "data");
const outPath = path.join(outDir, "viewer-data.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function safeReadJson(filePath) {
  try {
    return readJson(filePath);
  } catch {
    return null;
  }
}

function buildRiskMaps(risks) {
  const categoryById = new Map();
  const riskByKey = new Map();

  for (const category of risks || []) {
    if (!category?.id) continue;
    categoryById.set(category.id, category.name || category.id);
    for (const risk of category.risks || []) {
      if (!risk?.id) continue;
      riskByKey.set(`${category.id}:${risk.id}`, risk.name || risk.id);
    }
  }

  return { categoryById, riskByKey };
}

function listJsonFiles(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs
    .readdirSync(dirPath)
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.join(dirPath, name));
}

function normalizeScenarioRecord(record, fileName, categoryById, riskByKey) {
  const scenario = record?.scenario || {};
  const seed = scenario?.seed || {};
  const assessment = record?.assessment || {};
  const behavior = record?.behaviorAssessment || {};

  const riskCategoryId = seed.riskCategoryId || "";
  const riskId = seed.riskId || "";
  const riskKey = `${riskCategoryId}:${riskId}`;

  return {
    file: fileName,
    id: seed.id || fileName,
    prompt: record?.prompt || "default",
    riskCategoryId,
    riskCategoryName: categoryById.get(riskCategoryId) || riskCategoryId || "Unknown",
    riskId,
    riskName: riskByKey.get(riskKey) || riskId || "Unknown",
    ageRange: seed.ageRange || "",
    scenarioTitle: scenario.shortTitle || seed.shortTitle || "Untitled scenario",
    narrative: scenario.narrative || "",
    evaluationCriteria: scenario.evaluationCriteria || "",
    firstUserMessage: scenario.firstUserMessage || "",
    motivationName: seed?.motivation?.name || "",
    safetyGrade: assessment.grade || "",
    assessmentReasons: assessment.reasons || "",
    behaviorAssessment: behavior,
    messages: Array.isArray(record?.messages) ? record.messages : [],
  };
}

function pickTestResultsDir() {
  const top = listJsonFiles(testResultsDirTop);
  if (top.length > 0) return testResultsDirTop;
  return testResultsDirArchived;
}

function main() {
  const results = safeReadJson(resultsPath) || {};
  const risks = safeReadJson(risksPath) || [];
  const { categoryById, riskByKey } = buildRiskMaps(risks);

  const testResultsDir = pickTestResultsDir();
  const testResultFiles = listJsonFiles(testResultsDir);
  const scenarios = testResultFiles
    .map((filePath) => {
      const parsed = safeReadJson(filePath);
      if (!parsed) return null;
      return normalizeScenarioRecord(
        parsed,
        path.basename(filePath),
        categoryById,
        riskByKey
      );
    })
    .filter(Boolean);

  const output = {
    generatedAt: new Date().toISOString(),
    summary: {
      target: results.target || "",
      judge: results.judge || "",
      user: results.user || "",
      prompts: results.prompts || [],
      scores: results.scores || [],
    },
    risks,
    scenarios,
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(
    `Scenarios from ${path.relative(rootDir, testResultsDir)} (${scenarios.length} files)`
  );
  console.log(`Summary from ${path.relative(rootDir, resultsPath)}`);
  console.log(`Wrote ${path.relative(rootDir, outPath)}`);
}

main();

