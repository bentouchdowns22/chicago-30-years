# Project Brief: "Thirty Years of Chicago"

## One-line pitch
An interactive, animated data story of the Chicago Marathon from 1996 to 2023: how finish times, age mix, and gender balance changed over three decades, annotated with weather and qualifying-standard changes.

## Goals
1. A polished, static website (free to host on GitHub Pages) where the main visual is a year-by-year animated ridgeline/distribution plot with a scrubber.
2. A reproducible pipeline: raw Kaggle data -> cleaned, aggregated files -> site. Anyone can rerun it.
3. A README strong enough to serve as a portfolio piece: hero GIF/screenshot, one surprising finding at the top, methodology, and limitations.

## Non-goals
- No backend, database server, accounts, or paid services. Everything must be free.
- No scraping. Use only the Kaggle dataset below.
- No machine-learning predictions. This is descriptive data viz.

## Data source
- Kaggle dataset: "Chicago Marathon Results - 1996 To 2023" by runningwithrock (confirm the exact slug on the dataset page).
- Reported contents: individual finisher results (1996 onward), race dates, race-day weather (from Weather Spark), and a separate file of qualifying times introduced in 2014, 2018, and 2025.
- License/attribution: check the dataset page and credit the author in the README and site footer.

### Data rules
- FIRST STEP: download and inspect every file. Write `docs/data-dictionary.md` listing each file, columns, dtypes, row counts, missing-value rates, and the years covered. Do not assume column names before doing this.
- Never commit the raw data. Add `data/raw/` to `.gitignore`. Provide `scripts/download_data.py` that uses the Kaggle API (requires the user's free `~/.kaggle/kaggle.json`; fail with a clear message if missing).
- Commit only small, derived outputs (target: under 5 MB total in `site/public/data/`).

## Tech stack (keep it simple)
- **Pipeline:** Python 3.11+, pandas and/or DuckDB, output to JSON or Parquet. Use a `requirements.txt` or `pyproject.toml`.
- **Frontend:** Vite + vanilla TypeScript/JavaScript, Observable Plot for standard charts, D3 for the animated ridgeline and scrubber. No heavy framework.
- **Hosting:** GitHub Pages via a GitHub Actions workflow that builds and deploys on push to `main`.
- Note: if you think a different stack is clearly better, propose it before building.

## Repo structure
```
chicago-30-years/
  README.md
  PROJECT_BRIEF.md
  data/raw/            # gitignored
  data/processed/      # gitignored intermediates
  docs/data-dictionary.md
  scripts/
    download_data.py
    clean.py
    aggregate.py       # produces the compact files the site reads
  site/
    index.html
    src/
    public/data/       # committed, small aggregated outputs
  .github/workflows/deploy.yml
```

## Data processing requirements
- Standardize finish time to seconds. Drop or flag impossible values (e.g., non-finishers, zero or negative times, extreme outliers). Log how many rows are removed and why, per year.
- Normalize gender and age fields. Define age groups explicitly (e.g., 18-29, 30-39, ... 70+) and document them.
- Join race-day weather to each year (temperature, plus anything else available). Note any years with missing weather.
- Precompute per-year: finisher count, quantiles (p5/p25/p50/p75/p95) of finish time by gender and age group, a binned density curve for the ridgeline, and share of finishers by age group and gender.
- Verify data quality BEFORE building visuals: check for years with suspiciously low counts or odd distributions, and report them in the data dictionary. Do not hide anomalies. Explain them or annotate them.

## Site features (in priority order)
1. **Hero: animated ridgeline.** Finish-time distribution per year, stacked and ordered chronologically. Play/pause plus a year scrubber morphs between years. Toggle: all / women / men.
2. **Annotations layer.** Mark weather extremes (hot and cold race days) and the qualifying-standard changes (2014, 2018, 2025, from the qualifying file). Verify any special-year annotations (e.g., cancelled or disrupted races) from the data itself rather than assuming. Hover or click shows the source.
3. **Demographics panel.** Stacked area or small multiples: age mix and gender balance over time.
4. **Weather vs. performance.** Scatter of race-day temperature vs. median finish time by year, with a short honest note on correlation vs. causation.
5. **"Find yourself" widget (stretch).** Enter a finish time, age, and gender to see your percentile in a chosen year.

## Design requirements
- Clean, editorial look (think data-journalism): strong typography, restrained color palette, generous whitespace, annotations over legends where possible.
- Responsive down to a phone width. Wide visuals scroll or reflow gracefully.
- Accessible: sufficient contrast, keyboard-operable scrubber, alt text and a text summary for key charts.
- Respect `prefers-color-scheme` (light and dark).

## Milestones with acceptance criteria
1. **M1: Data audit.** `download_data.py` works; `docs/data-dictionary.md` complete; anomalies listed. *Done when:* a fresh clone plus a Kaggle token reproduces the audit.
2. **M2: Clean + aggregate.** Scripts produce the committed aggregate files with row-removal logs. *Done when:* outputs are under the size budget and a short test script checks sanity (e.g., yearly counts, monotonic quantiles).
3. **M3: Hero chart.** Animated ridgeline with scrubber and gender toggle. *Done when:* it runs smoothly at 60 fps on a normal laptop and works on mobile.
4. **M4: Annotations + secondary charts.** Weather, qualifying standards, demographics.
5. **M5: Polish + deploy.** GitHub Actions deploy to Pages; README complete with hero GIF.

## README requirements
- Hero GIF or screenshot at the very top plus a live-site link.
- One surprising finding stated up front (derived from the actual data, never invented).
- "How to run it" in under 5 commands.
- Methodology (cleaning rules, age-group definitions, weather join) and a Limitations section (e.g., self-reported ages, scraped sources, weather measured at one station, survivorship bias: only finishers are included).
- Data attribution and license.

## Working agreements for the agent
- Work milestone by milestone; summarize what you did and what you found at the end of each, then wait for approval before starting the next.
- Do not invent facts, columns, or findings. If the data does not support an annotation or claim, say so.
- Ask me when something is ambiguous instead of guessing.
- Keep commits small with clear messages so the history shows progress.
- Prefer boring, well-documented libraries over clever ones.