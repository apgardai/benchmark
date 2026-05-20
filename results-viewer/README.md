# Benchmark Results Viewer

Static, no-auth results explorer for child safety benchmark outputs.

## What it shows

- Benchmark summary (target/judge/user/prompts + counts)
- Risk summary cards (click to drill down)
- Filterable scenario list
- Scenario overlay with:
  - assessment reasons
  - scenario narrative
  - full conversation
- CSV export for currently filtered scenarios

## Build viewer data

From `child-safety-evals/benchmark`:

```bash
node ./results-viewer/build-viewer-data.mjs
```

This reads:

- **Overall run summary** (stable, not overwritten by benchmark runs):  
  `results-viewer/archived-results/results.json`  
  (`target`, `judge`, `user`, `prompts`, and grouped `scores` — see benchmark `README.md` *Interpreting results*.)
- **Per-scenario test JSON**: `results-viewer/testResults/*.json`  
  If that directory is empty, falls back to `results-viewer/archived-results/testResults/*.json`.
- **Taxonomy labels**: `packages/benchmark/data/risks.json`

and writes:

- `results-viewer/data/viewer-data.json`

## Archive new runs

After running `yarn cs-bench run`, archive the fresh output before the next run overwrites `data/`:

```bash
yarn results-viewer:archive
```

Then rebuild viewer data:

```bash
yarn results-viewer:data
```

## Run locally

Serve the benchmark directory as static files:

```bash
python3 -m http.server 8000
```

Then open:

- `http://localhost:8000/results-viewer/`

