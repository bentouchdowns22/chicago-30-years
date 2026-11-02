# Chicago Marathon Data Visualization

**Live site:** https://bentouchdowns22.github.io/chicago-30-years/

An interactive look at 30 years of Chicago Marathon finish times (1996 to 2023). The typical finish time barely changed, but the field spread out: the middle half of runners went from spanning 55 minutes to 83. The page also looks at race-day temperature, the edge at 4:00:00, and how the field aged.

## Run it

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/kaggle auth login                  # one-time, free Kaggle account
.venv/bin/python scripts/download_data.py    # raw data into data/raw/ (not committed)
.venv/bin/python scripts/clean.py && .venv/bin/python scripts/aggregate.py
cd site && npm install && npm run dev        # http://localhost:5173
```

Checks: `.venv/bin/python scripts/test_outputs.py` (23 checks on the cleaned and aggregated data).

## How it works

- `scripts/download_data.py` downloads the Kaggle dataset. `scripts/clean.py` converts times to seconds, removes 5 exact duplicate rows and drops names. `scripts/aggregate.py` writes the small JSON files in `site/public/data/` that the site reads. `scripts/export_runners.py` writes one file per year in `site/public/data/runners/` (names included), loaded only when the random-finisher button is pressed.
- `site/` is a Vite + TypeScript app using D3. A GitHub Actions workflow builds it and deploys to GitHub Pages on every push to `main`.
- `docs/data-dictionary.md` lists every file and column, every anomaly found, and the decisions made about them.

## Methodology and limits

- Only finishers are included. Ages in the source are 5-year bands. Runner names are used only for the "Meet a random finisher" button, from the public results.
- Finish times are kept for every finisher. The chart axis stops at 7:00; later finishers (0.8%) are still counted in every number.
- 1996 is missing about 11% of results and 2022 about 8%; the 2022 gaps show up as notches in that year's hill. The typical time is barely affected in both.
- The 2007 race was halted by heat, so its times are not comparable to other years. The data can't show how many runners were stopped.
- The temperature link is a correlation (r = 0.70, 26 years) using one noon reading at one weather station. Units are assumed to be °F.
- Place numbers (`Overall`) are unreliable in several years, so everything ranks by finish time.

## Data and credit

- Results: chicagomarathon.com, collected in the Kaggle dataset [Chicago Marathon Results - 1996 to 2023](https://www.kaggle.com/datasets/runningwithrock/chicago-marathon-results) by **runningwithrock** (MIT license).
- Weather: [Weather Spark](https://weatherspark.com/), as included in that dataset.
- Code: see `LICENSE`.
