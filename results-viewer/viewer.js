(async function main() {
  const data = await fetch("./data/viewer-data.json").then((r) => r.json());

  const state = {
    selectedRiskKey: "",
    filters: {
      riskCategoryId: "all",
      riskId: "all",
      prompt: "all",
      ageRange: "all",
      grade: "all",
      search: "",
    },
  };

  const summaryEl = document.getElementById("summary");
  const riskSummaryEl = document.getElementById("riskSummary");
  const scenarioListEl = document.getElementById("scenarioList");
  const scenarioCountEl = document.getElementById("scenarioCount");

  const riskCategoryFilterEl = document.getElementById("riskCategoryFilter");
  const riskFilterEl = document.getElementById("riskFilter");
  const promptFilterEl = document.getElementById("promptFilter");
  const ageRangeFilterEl = document.getElementById("ageRangeFilter");
  const gradeFilterEl = document.getElementById("gradeFilter");
  const searchFilterEl = document.getElementById("searchFilter");
  const exportCsvBtn = document.getElementById("exportCsvBtn");

  const modal = document.getElementById("scenarioModal");
  const closeModalBtn = document.getElementById("closeModalBtn");
  const modalTitle = document.getElementById("modalTitle");
  const modalMeta = document.getElementById("modalMeta");
  const modalAssessment = document.getElementById("modalAssessment");
  const modalNarrative = document.getElementById("modalNarrative");
  const modalConversation = document.getElementById("modalConversation");

  function uniq(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function option(label, value) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    return o;
  }

  function setSelectOptions(selectEl, values, allLabel = "All") {
    selectEl.innerHTML = "";
    selectEl.appendChild(option(allLabel, "all"));
    for (const v of values) {
      selectEl.appendChild(option(v, v));
    }
  }

  function renderSummary() {
    const s = data.summary || {};
    const totalScenarios = data.scenarios.length;
    const cards = [
      ["Target model", s.target || "-"],
      ["Judge model", s.judge || "-"],
      ["User model", s.user || "-"],
      ["Prompts", (s.prompts || []).join(", ") || "-"],
      ["Risk groups", String((s.scores || []).length)],
      ["Scenarios loaded", String(totalScenarios)],
    ];

    summaryEl.innerHTML = cards
      .map(
        ([label, value]) =>
          `<div class="summary-item"><div class="label">${label}</div><div class="value">${value}</div></div>`
      )
      .join("");
  }

  function buildRiskSummaryMap() {
    const map = new Map();
    for (const score of data.summary.scores || []) {
      const key = `${score.riskCategoryId}:${score.riskId}`;
      map.set(key, score);
    }
    return map;
  }

  const riskSummaryMap = buildRiskSummaryMap();

  function renderRiskSummary() {
    const cards = [];
    for (const [key, score] of riskSummaryMap.entries()) {
      const as = score?.sums?.as || [0, 0, 0];
      const [failing, adequate, exemplary] = as;
      const activeClass = state.selectedRiskKey === key ? " active" : "";
      cards.push(`
        <button class="risk-card${activeClass}" data-risk-key="${key}">
          <div><strong>${score.riskId}</strong></div>
          <div class="small muted">${score.riskCategoryId}</div>
          <div class="small">Failing: ${failing} | Adequate: ${adequate} | Exemplary: ${exemplary}</div>
        </button>
      `);
    }
    riskSummaryEl.innerHTML = cards.join("");
    for (const btn of riskSummaryEl.querySelectorAll("[data-risk-key]")) {
      btn.addEventListener("click", () => {
        const riskKey = btn.getAttribute("data-risk-key");
        state.selectedRiskKey = state.selectedRiskKey === riskKey ? "" : riskKey;
        if (state.selectedRiskKey) {
          const [category, risk] = state.selectedRiskKey.split(":");
          state.filters.riskCategoryId = category;
          state.filters.riskId = risk;
          riskCategoryFilterEl.value = category;
          syncRiskOptions();
          riskFilterEl.value = risk;
        }
        renderRiskSummary();
        renderScenarios();
      });
    }
  }

  function applyFilters(records) {
    return records.filter((r) => {
      if (state.filters.riskCategoryId !== "all" && r.riskCategoryId !== state.filters.riskCategoryId) return false;
      if (state.filters.riskId !== "all" && r.riskId !== state.filters.riskId) return false;
      if (state.filters.prompt !== "all" && r.prompt !== state.filters.prompt) return false;
      if (state.filters.ageRange !== "all" && r.ageRange !== state.filters.ageRange) return false;
      if (state.filters.grade !== "all" && r.safetyGrade !== state.filters.grade) return false;
      if (state.filters.search) {
        const q = state.filters.search.toLowerCase();
        const hay = `${r.scenarioTitle}\n${r.narrative}\n${r.riskId}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function badgeClass(grade) {
    if (!grade) return "badge";
    return `badge ${grade}`;
  }

  function renderScenarios() {
    const filtered = applyFilters(data.scenarios);
    scenarioCountEl.textContent = `${filtered.length} scenario(s)`;

    scenarioListEl.innerHTML = filtered
      .map(
        (r, i) => `
        <button class="scenario-item" data-scenario-index="${i}">
          <div class="row between">
            <strong>${r.scenarioTitle}</strong>
            <span class="${badgeClass(r.safetyGrade)}">${r.safetyGrade || "unknown"}</span>
          </div>
          <div class="small muted">${r.riskCategoryId} / ${r.riskId} • ${r.prompt} • ${r.ageRange}</div>
        </button>
      `
      )
      .join("");

    for (const btn of scenarioListEl.querySelectorAll("[data-scenario-index]")) {
      btn.addEventListener("click", () => {
        const idx = Number(btn.getAttribute("data-scenario-index"));
        openScenarioModal(filtered[idx]);
      });
    }
  }

  function openScenarioModal(record) {
    if (!record) return;
    modalTitle.textContent = record.scenarioTitle;
    modalMeta.textContent = `${record.riskCategoryId} / ${record.riskId} • ${record.prompt} • ${record.ageRange}`;
    modalAssessment.textContent = record.assessmentReasons || "No assessment text available.";
    modalNarrative.textContent = record.narrative || "No narrative.";

    modalConversation.innerHTML = (record.messages || [])
      .map(
        (m) => `
        <div class="message">
          <div class="role">${(m.role || "").toUpperCase()}</div>
          <div class="pre">${m.content || ""}</div>
        </div>
      `
      )
      .join("");

    modal.classList.remove("hidden");
  }

  function closeModal() {
    modal.classList.add("hidden");
  }

  function syncRiskOptions() {
    const cat = state.filters.riskCategoryId;
    const risks = uniq(
      data.scenarios
        .filter((r) => cat === "all" || r.riskCategoryId === cat)
        .map((r) => r.riskId)
    );
    const prev = state.filters.riskId;
    setSelectOptions(riskFilterEl, risks, "All risks");
    if (risks.includes(prev)) {
      riskFilterEl.value = prev;
    } else {
      state.filters.riskId = "all";
      riskFilterEl.value = "all";
    }
  }

  function initFilters() {
    setSelectOptions(
      riskCategoryFilterEl,
      uniq(data.scenarios.map((r) => r.riskCategoryId)),
      "All categories"
    );
    setSelectOptions(
      promptFilterEl,
      uniq(data.scenarios.map((r) => r.prompt)),
      "All prompts"
    );
    setSelectOptions(
      ageRangeFilterEl,
      uniq(data.scenarios.map((r) => r.ageRange)),
      "All ages"
    );
    setSelectOptions(
      gradeFilterEl,
      uniq(data.scenarios.map((r) => r.safetyGrade)),
      "All grades"
    );
    syncRiskOptions();

    riskCategoryFilterEl.addEventListener("change", () => {
      state.filters.riskCategoryId = riskCategoryFilterEl.value;
      state.selectedRiskKey = "";
      syncRiskOptions();
      renderRiskSummary();
      renderScenarios();
    });
    riskFilterEl.addEventListener("change", () => {
      state.filters.riskId = riskFilterEl.value;
      state.selectedRiskKey = "";
      renderRiskSummary();
      renderScenarios();
    });
    promptFilterEl.addEventListener("change", () => {
      state.filters.prompt = promptFilterEl.value;
      renderScenarios();
    });
    ageRangeFilterEl.addEventListener("change", () => {
      state.filters.ageRange = ageRangeFilterEl.value;
      renderScenarios();
    });
    gradeFilterEl.addEventListener("change", () => {
      state.filters.grade = gradeFilterEl.value;
      renderScenarios();
    });
    searchFilterEl.addEventListener("input", () => {
      state.filters.search = searchFilterEl.value.trim();
      renderScenarios();
    });
  }

  function csvEscape(value) {
    const s = String(value ?? "");
    if (s.includes('"') || s.includes(",") || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  function exportFilteredCsv() {
    const filtered = applyFilters(data.scenarios);
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
    const rows = filtered.map((r) => {
      const conversation = (r.messages || [])
        .map((m) => `${(m.role || "").toUpperCase()}: ${m.content || ""}`)
        .join("\n");
      return [
        r.id,
        r.scenarioTitle,
        r.riskCategoryId,
        r.riskId,
        r.prompt,
        r.ageRange,
        r.safetyGrade,
        r.assessmentReasons,
        r.narrative,
        conversation,
      ]
        .map(csvEscape)
        .join(",");
    });
    const content = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "benchmark-filtered-scenarios.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  closeModalBtn.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target instanceof HTMLElement && e.target.dataset.close === "1") {
      closeModal();
    }
  });
  exportCsvBtn.addEventListener("click", exportFilteredCsv);

  renderSummary();
  initFilters();
  renderRiskSummary();
  renderScenarios();
})();

