"use client";

import { useEffect, useMemo, useState } from "react";

type Score = {
  riskCategoryId: string;
  riskId: string;
  ageRange: string;
  prompt: string;
  sums: { al: number; as: [number, number, number] };
};

type Scenario = {
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

type ViewerData = {
  summary: {
    target: string;
    judge: string;
    user: string;
    prompts: string[];
    scores: Score[];
  };
  scenarios: Scenario[];
};

type Filters = {
  riskCategoryId: string;
  riskId: string;
  prompt: string;
  ageRange: string;
  grade: string;
  search: string;
};

const initialFilters: Filters = {
  riskCategoryId: "all",
  riskId: "all",
  prompt: "all",
  ageRange: "all",
  grade: "all",
  search: "",
};

function uniq(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function csvEscape(value: unknown) {
  const s = String(value ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export default function Page() {
  const [data, setData] = useState<ViewerData | null>(null);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [selectedRiskKey, setSelectedRiskKey] = useState("");
  const [openScenario, setOpenScenario] = useState<Scenario | null>(null);

  useEffect(() => {
    fetch("/api/viewer-data")
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => setData({ summary: { target: "", judge: "", user: "", prompts: [], scores: [] }, scenarios: [] }));
  }, []);

  const riskOptions = useMemo(() => {
    if (!data) return [] as string[];
    return uniq(
      data.scenarios
        .filter((s) => filters.riskCategoryId === "all" || s.riskCategoryId === filters.riskCategoryId)
        .map((s) => s.riskId)
    );
  }, [data, filters.riskCategoryId]);

  const filtered = useMemo(() => {
    if (!data) return [] as Scenario[];
    return data.scenarios.filter((s) => {
      if (filters.riskCategoryId !== "all" && s.riskCategoryId !== filters.riskCategoryId) return false;
      if (filters.riskId !== "all" && s.riskId !== filters.riskId) return false;
      if (filters.prompt !== "all" && s.prompt !== filters.prompt) return false;
      if (filters.ageRange !== "all" && s.ageRange !== filters.ageRange) return false;
      if (filters.grade !== "all" && s.safetyGrade !== filters.grade) return false;
      if (filters.search) {
        const q = filters.search.toLowerCase();
        if (!`${s.scenarioTitle}\n${s.narrative}\n${s.riskId}`.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [data, filters]);

  function onRiskCardClick(key: string) {
    const isSame = selectedRiskKey === key;
    setSelectedRiskKey(isSame ? "" : key);
    if (!isSame) {
      const [riskCategoryId, riskId] = key.split(":");
      setFilters((f) => ({ ...f, riskCategoryId, riskId }));
    }
  }

  function exportCsv() {
    const headers = [
      "scenario_id",
      "scenario_title",
      "risk_category_id",
      "risk_id",
      "prompt",
      "age_range",
      "safety_grade",
      "assessment_reasons",
      "scenario_narrative",
      "conversation",
    ];
    const rows = filtered.map((s) => {
      const convo = s.messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n");
      return [
        s.id,
        s.scenarioTitle,
        s.riskCategoryId,
        s.riskId,
        s.prompt,
        s.ageRange,
        s.safetyGrade,
        s.assessmentReasons,
        s.narrative,
        convo,
      ].map(csvEscape).join(",");
    });
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "benchmark-filtered-scenarios.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const summary = data?.summary;

  return (
    <main className="container">
      <h1>Child Safety SSH Benchmark Results</h1>
      <p className="muted">Standalone no-auth Next.js viewer.</p>

      <section className="card summary-grid">
        <div className="summary-item"><div className="muted small">Target</div><div>{summary?.target || "-"}</div></div>
        <div className="summary-item"><div className="muted small">Judge</div><div>{summary?.judge || "-"}</div></div>
        <div className="summary-item"><div className="muted small">User</div><div>{summary?.user || "-"}</div></div>
        <div className="summary-item"><div className="muted small">Prompts</div><div>{summary?.prompts?.join(", ") || "-"}</div></div>
        <div className="summary-item"><div className="muted small">Risk groups</div><div>{summary?.scores?.length || 0}</div></div>
        <div className="summary-item"><div className="muted small">Scenarios loaded</div><div>{data?.scenarios?.length || 0}</div></div>
      </section>

      <section className="card">
        <div className="row between">
          <h2>Risk Summary</h2>
          <button className="btn" onClick={exportCsv}>Export Filtered CSV</button>
        </div>
        <div className="muted small">Click a risk to drill down.</div>
        <div className="risk-grid">
          {(summary?.scores || []).map((score) => {
            const key = `${score.riskCategoryId}:${score.riskId}`;
            const active = selectedRiskKey === key;
            return (
              <button key={`${key}:${score.prompt}`} className={`risk-btn${active ? " active" : ""}`} onClick={() => onRiskCardClick(key)}>
                <div><strong>{score.riskId}</strong></div>
                <div className="small muted">{score.riskCategoryId}</div>
                <div className="small">Failing: {score.sums.as[0]} | Adequate: {score.sums.as[1]} | Exemplary: {score.sums.as[2]}</div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="card">
        <h2>Filters</h2>
        <div className="filters">
          <label>
            <span>Risk category</span>
            <select value={filters.riskCategoryId} onChange={(e) => setFilters((f) => ({ ...f, riskCategoryId: e.target.value, riskId: "all" }))}>
              <option value="all">All categories</option>
              {uniq((data?.scenarios || []).map((s) => s.riskCategoryId)).map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <label>
            <span>Risk</span>
            <select value={filters.riskId} onChange={(e) => setFilters((f) => ({ ...f, riskId: e.target.value }))}>
              <option value="all">All risks</option>
              {riskOptions.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <label>
            <span>Prompt</span>
            <select value={filters.prompt} onChange={(e) => setFilters((f) => ({ ...f, prompt: e.target.value }))}>
              <option value="all">All prompts</option>
              {uniq((data?.scenarios || []).map((s) => s.prompt)).map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <label>
            <span>Age range</span>
            <select value={filters.ageRange} onChange={(e) => setFilters((f) => ({ ...f, ageRange: e.target.value }))}>
              <option value="all">All ages</option>
              {uniq((data?.scenarios || []).map((s) => s.ageRange)).map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <label>
            <span>Safety grade</span>
            <select value={filters.grade} onChange={(e) => setFilters((f) => ({ ...f, grade: e.target.value }))}>
              <option value="all">All grades</option>
              {uniq((data?.scenarios || []).map((s) => s.safetyGrade)).map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <label>
            <span>Search</span>
            <input type="text" placeholder="Title or narrative" value={filters.search} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))} />
          </label>
        </div>
      </section>

      <section className="card">
        <div className="row between">
          <h2>Scenarios</h2>
          <div className="muted">{filtered.length} scenario(s)</div>
        </div>
        <div className="scenario-list">
          {filtered.map((s) => (
            <button key={`${s.id}:${s.prompt}:${s.file}`} className="scenario-btn" onClick={() => setOpenScenario(s)}>
              <div className="row between">
                <strong>{s.scenarioTitle}</strong>
                <span className={`badge ${s.safetyGrade || ""}`}>{s.safetyGrade || "unknown"}</span>
              </div>
              <div className="small muted">{s.riskCategoryId} / {s.riskId} • {s.prompt} • {s.ageRange}</div>
            </button>
          ))}
        </div>
      </section>

      {openScenario && (
        <div className="modal">
          <div className="backdrop" onClick={() => setOpenScenario(null)} />
          <div className="modal-content">
            <button className="close" onClick={() => setOpenScenario(null)} aria-label="Close">×</button>
            <h2>{openScenario.scenarioTitle}</h2>
            <div className="small muted">{openScenario.riskCategoryId} / {openScenario.riskId} • {openScenario.prompt} • {openScenario.ageRange}</div>
            <h3>Assessment</h3>
            <p className="pre">{openScenario.assessmentReasons || "No assessment text available."}</p>
            <h3>Scenario Narrative</h3>
            <p className="pre">{openScenario.narrative || "No narrative available."}</p>
            <h3>Conversation</h3>
            <div className="conversation">
              {openScenario.messages.map((m, idx) => (
                <div key={`${m.role}-${idx}`} className="msg">
                  <div className="role">{m.role.toUpperCase()}</div>
                  <div className="pre">{m.content}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

