# Loading-state benchmark

The pages and scripts behind the loading checks (`loading-state`, `layout-shift`) and the UX pass (`--ux`). The results are in [docs/results.md](../../docs/results.md#loading-states-and---ux).

- `app/`: a Vite + React 19 app whose fake API (`vite.config.js`) answers in 60ms, as on a dev machine. Each page is `app/src/s/<id>.jsx`, served at `/s/<id>`. The labels are in three files:
  - `scenarios.json`: our 41 pages (load, click, route, freeze).
  - `blind.json`: 24 pages written by an agent that never saw the detector.
  - `ux.json`: 10 pages for error handling, dead buttons, double submits, layout shift and slow renders.
- `run.mjs`: runs renderlint on each page and prints the rules it triggered next to the label.
- `experiment/`: the harness used to compare detection methods before any were built into renderlint. `run.mjs` records what each page shows while its requests are held, and `score.mjs` scores each method against the labels.

```bash
cd bench/loading/app && npm install && npm run dev        # http://localhost:5393
node bench/loading/run.mjs bench/loading/app/scenarios.json --vp 375
node bench/loading/run.mjs bench/loading/app/blind.json --ux
node bench/loading/experiment/run.mjs && node bench/loading/experiment/score.mjs
```
