# Next.js Benchmark Results Viewer

Standalone no-auth Next.js app for exploring benchmark outputs.

## Run

From this directory:

```bash
npm install
npm run dev
```

Open:

- `http://localhost:3000`

## Data source

The app reads local benchmark artifacts directly from:

- `../data/results.json`
- `../data/results/testResults/*.json`
- `../packages/benchmark/data/risks.json`

