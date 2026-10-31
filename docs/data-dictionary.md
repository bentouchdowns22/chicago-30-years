# Data dictionary and audit (Milestone 1)

Produced by `scripts/download_data.py` (download) and `scripts/audit_data.py` (statistics). Every number below comes from the raw files as downloaded; nothing has been cleaned yet.

## Sources and licenses

| Item | Source | License / terms |
|---|---|---|
| Kaggle packaging | [`runningwithrock/chicago-marathon-results`](https://www.kaggle.com/datasets/runningwithrock/chicago-marathon-results), "Chicago Marathon Results - 1996 to 2023", by runningwithrock. Last updated 2024-07-13. | **MIT** (as listed in the dataset's Kaggle metadata) |
| Finisher results and qualifying times | chicagomarathon.com ([race results](https://www.chicagomarathon.com/runners/race-results/)), as scraped by the dataset author | No separate license stated. The MIT license covers the Kaggle packaging; the underlying results belong to the race organizer. |
| Weather | [Weather Spark](https://weatherspark.com/), as collected by the dataset author | No separate license stated. |

The author's original analysis: <https://runningwithrock.com/chicago-qualifying-times/>. Credit the author in the README and site footer.

## Files

Downloaded to `data/raw/` (gitignored). All three are UTF-8 with a byte-order mark; read them with `encoding="utf-8-sig"` or the first column name gets a hidden prefix character.

| File | Rows | Size |
|---|---|---|
| `Chicago Marathon Results.csv` | 886,546 | 50.7 MB |
| `Chicago Marathon Weather.csv` | 45 | 3.3 KB |
| `Chicago Marathon Qualifying Times.csv` | 24 | 711 B |

### Results (`Chicago Marathon Results.csv`)

One row per finisher. Years covered: **1996-2019, 2021, 2022, 2023** (27 race years; no 2020 race). Rows are in random order, not sorted by year.

| Column | Type | Missing | Meaning and notes |
|---|---|---|---|
| `Race` | text | 0 | Always `Chicago`. Useless; drop. |
| `Year` | int | 0 | Race year. |
| `Name` | text | 3 (0.0%) | Runner's name. Personal data; never publish or commit it. 3 blanks (1999, 2011, 2012). |
| `Gender` | text | 0 | Only `M` (498,574) and `F` (387,972). No other values. |
| `Age` | int | 0 | **Not an exact age.** Only 14 distinct values: 19, 24, 29, 34, 39, 44, 49, 54, 59, 64, 69, 74, 79, 80. It appears to be the upper edge of a 5-year age band (19 = 19 and under, 24 = 20-24, ... 79 = 75-79, 80 = 80+). That reading is my inference from the pattern, not documented by the dataset. |
| `Country` | text | 0 | 3-letter country code (e.g. `USA`, `MEX`). **2,416 rows (0.3%) hold junk** such as `avi`, `Mar`, `Pau`: they look like fragments of names from scraping errors. Concentrated in 2008-2013 (about 2,360 of them). |
| `Overall` | int | 0 | Overall place. **Unreliable in several years**, see anomalies. |
| `Finish Time` | text `HH:MM:SS` | 0 | All 886,546 values parse. Range 2:00:35 to 11:25:07. Not stated whether this is gun time or chip time. |
| `Finish` | int | 0 | Finish time in **seconds**. Matches `Finish Time` exactly in every row, so it is redundant. |

Finishers only: there are no DNF, DNS or disqualified rows, so "non-finisher" cleaning from the brief is unnecessary.

### Weather (`Chicago Marathon Weather.csv`)

One row per race year, **1977-2023, 45 rows** (1987 and 2020 absent). No missing values. Units are not stated in the file; values look like **degrees Fahrenheit** and **miles per hour** (e.g. 37.4 in October, 84.0 on the hot 2007 day), which I have not confirmed with the source.

| Column | Type | Meaning |
|---|---|---|
| `Year`, `Month`, `Day`, `Date` | int, text, int, text | Race date (e.g. `Oct 20, 1996`). |
| `6AM Temp`, `9AM Temp`, `12PM Temp` | float | Temperature at 6 AM, 9 AM, noon. |
| `6AM Dew`, `9AM Dew`, `12PM Dew` | float | Dew point at those times. |
| `6AM Wind`, `9AM Wind`, `12PM Wind` | float | Wind speed at those times. |

Every results year has a weather row. The 18 rows for 1977-1995 predate the results and will go unused. Weather comes from a single source and station.

### Qualifying times (`Chicago Marathon Qualifying Times.csv`)

24 rows: 12 age groups x 2 genders. Values are the **qualifying time in seconds** (e.g. 11700 = 3:15:00).

| Column | Type | Notes |
|---|---|---|
| `Gender` | text | `M` / `F` |
| `Chicago Age` | text | `Under 30`, `30-34`, ... `75-79`, `80 and Over` |
| `2025 CQ` | int seconds | 2025 standard |
| `2024 CQ` | int seconds | Labeled 2024 in the file. We call it the **2018-2024 standard** (assumption, see Decisions) |
| `2014 CQ` | int seconds | 2014 standard (labeled this way on the site): one flat time for all ages (men 3:15:00, women 3:45:00) |

No missing values.

## Age groups available for analysis

Because ages are 5-year bands, the brief's example groups can be built exactly by combining bands: 18-29 (bands 19, 24, 29), 30-39 (34, 39), 40-49 (44, 49), 50-59 (54, 59), 60-69 (64, 69), 70+ (74, 79, 80). The 19 band includes anyone 19 or younger, so "18-29" really means "29 and under". Finer groups than 5 years are impossible.

## Finisher counts and quality checks by year

| Year | Rows | Men | Women | Median finish (min) | Notes |
|---|---|---|---|---|---|
| 1996 | 8,194 | 5,626 | 2,568 | 246.6 | Highest `Overall` is 9,194, so about 1,000 ranks have no row |
| 1997 | 14,386 | 9,590 | 4,796 | 246.5 | |
| 1998 | 17,201 | 10,946 | 6,255 | 254.0 | |
| 1999 | 24,625 | 15,287 | 9,338 | 251.5 | `Overall` broken |
| 2000 | 27,911 | 16,823 | 11,088 | 257.7 | |
| 2001 | 28,672 | 17,304 | 11,368 | 256.4 | `Overall` broken |
| 2002 | 31,123 | 18,137 | 12,986 | 256.4 | |
| 2003 | 32,362 | 18,690 | 13,672 | 262.5 | |
| 2004 | 33,084 | 19,106 | 13,978 | 263.5 | |
| 2005 | 32,868 | 18,602 | 14,266 | 262.8 | |
| 2006 | 33,636 | 18,911 | 14,725 | 261.0 | `Overall` partly duplicated |
| 2007 | 25,521 | 15,337 | 10,184 | **295.0** | Count drops about 24% and the median is the slowest in the file; weather row shows 71 F at 6 AM and 84 F at noon. See anomalies |
| 2008 | 31,345 | 17,679 | 13,666 | 283.7 | `Overall` broken |
| 2009 | 33,569 | 18,948 | 14,621 | 263.4 | `Overall` broken |
| 2010 | 36,086 | 19,946 | 16,140 | 280.6 | `Overall` broken |
| 2011 | 35,752 | 20,282 | 15,470 | 277.9 | `Overall` broken |
| 2012 | 37,470 | 20,679 | 16,791 | 267.4 | `Overall` broken |
| 2013 | 38,873 | 21,481 | 17,392 | 267.4 | `Overall` broken |
| 2014 | 40,605 | 22,200 | 18,405 | 267.4 | |
| 2015 | 37,442 | 20,187 | 17,255 | 270.8 | |
| 2016 | 40,556 | 22,032 | 18,524 | 268.4 | |
| 2017 | 44,348 | 22,823 | 21,525 | 282.7 | Longest-tail year: 5.7% of finishers over 6.5 h |
| 2018 | 44,551 | 23,912 | 20,639 | 267.5 | |
| 2019 | 45,866 | 24,572 | 21,294 | 262.1 | |
| 2020 | none | none | none | none | No results and no weather row |
| 2021 | 26,080 | 14,203 | 11,877 | 278.7 | Smaller field |
| 2022 | 36,265 | 19,599 | 16,666 | 261.8 | **Incomplete**: highest `Overall` is 39,313, so about 3,100 ranks have no row |
| 2023 | 48,155 | 25,672 | 22,483 | 251.7 | About 230 ranks missing; fastest time in the file (2:00:35) |

## Anomalies

1. **2022 looks incomplete (about 8% of finishers missing).** There are 36,265 rows, but place numbers run to 39,313, with about 3,100 gaps starting at place 697. Any 2022 count, share or quantile rests on a partial field. Cause unknown; likely a scraping gap.
2. **`Overall` is not trustworthy.** In 1999, 2001 and 2008-2013 only about a third of the values are unique (e.g. 2009: 11,442 distinct values across 33,569 rows, up to 16 runners sharing one). In 1996, 1999, 2009, 2022 and 2023 there are also many gaps. **Do not use `Overall` for ranking or percentiles; rank by `Finish Time` instead.** (Of the years I spot-checked, `Finish Time` order matches `Overall` in 1999, 2001, 2008, 2009, 2022 and 2023, but not in 1996 or 2006.)
3. **2007 stands out.** Finisher count falls to 25,521 (from 33,636 in 2006 and 32,868 in 2005, then 31,345 in 2008). The median is 295 min, 34 min slower than 2006 and 11 min slower than 2008, and the slowest time is 7.2 h (only 3 finishers took over 7 h, versus 100-300 in most other years). The weather row shows the warmest start in the file other than 2021. The data are consistent with a hot-weather race with an early cutoff, but the dataset itself does not say what happened, so any annotation must be sourced separately.
4. **2020 absent**; **2021 is smaller** (26,080) than neighboring years. The data do not say why; I have not assumed.
5. **5 exact duplicate rows** (same year, name, gender, age, time, place) in 2001, 2009, 2010, 2012, 2013. Negligible but should be removed.
6. **3 rows with blank names** (1999, 2011, 2012). Harmless for aggregates.
7. **Country junk** in 2,416 rows (see above). Not needed for the planned charts; do not use `Country` without cleaning.
8. **Very long finish times.** 55 finishers exceed 9 hours, up to 11.4 h. The share finishing over 6.5 h climbs from about 1% around 2000 to 3-5% after 2008. These look real (slow walkers) rather than errors, but they stretch the right tail of the distribution plots, and the extreme ones need a documented cutoff decision.
9. **Fastest times look plausible:** no finish is under 2:00:35 (a man, 2023); the fastest women's times in the two years I checked were 2:14:04 (2019) and 2:14:18 (2022).
10. **Age is banded** (see above); exact-age analysis is impossible.

## Mismatches with the brief

- **Qualifying standards: the file has 2014, 2024 and 2025, not 2014, 2018, 2025.** The brief (and the dataset's own description) say 2014, 2018 and 2025. The columns are labeled `2025 CQ`, `2024 CQ`, `2014 CQ`. Either the 2018 column is mislabeled 2024 or there really was a 2024 standard. I cannot tell from the data. **Decision needed before annotating.**
- The 2014 standard is a single flat time per gender, with no age grading; the 2024/2025 standards are age-graded.
- The brief said "1996 to 2023" with weather for "each year"; true, but with 2020 missing there are 27 race years, not 28.
- Age groups: see above; the brief's groups work but "18-29" really means "29 and under".
- Brief requires the download script to use `~/.kaggle/kaggle.json`. The current Kaggle tool also accepts `~/.kaggle/access_token` or `kaggle auth login`; the script's error message mentions all of them.

## Decisions (project owner, after the Milestone 1 audit)

1. **Qualifying columns.** Labeled on the site as the "2014 standard", "2018-2024 standard (file column: 2024)" and "2025 standard". **The 2018-2024 mapping is an assumption** based on an outside source and is still to be confirmed; the file itself only says "2024".
2. **2022.** Keep it in distribution charts with a visible marker: "partial data, about 8% of finishers missing". Exclude it from any chart that shows finisher counts.
3. **Finish times.** Keep every finisher in all statistics. Cap only the chart axis at about 7 hours, and report how many finishers fall beyond the cap (in the raw data, 6,868 of 886,546 finishers, 0.8%, took longer than 7 hours; the per-year split will be produced in Milestone 2).
4. **2007.** Annotate as a race halted mid-course because of record heat (about 88 F); the owner will supply the source. **2007 times are not directly comparable to other years** (the race was cut short, so the finisher count and times reflect that). Note that the weather file's own 2007 noon reading is 84 F, which differs from the roughly 88 F cited, because it is a single-station Weather Spark value at fixed hours; do not present the two as the same measurement.
5. **Ranking and cleaning.** Rank by finish time, never by `Overall`. Ignore `Country`. Drop the 5 exact duplicate rows during cleaning (and log them).

### 2007 sources and temperature notes

I opened all four sources and checked what each one says (checked 2026-10-31):

| Source | What it supports |
|---|---|
| [NPR](https://www.npr.org/2007/10/08/15091688/heat-mars-weekend-marathons-two-die) | "Record-breaking hot weather forced a halt to the Chicago Marathon." The previous marathon record was 84 F (1979), broken before 10 AM; by 11:30 officials declared the race over. No exact 2007 temperature. |
| [WBEZ](https://www.wbez.org/2007/10/07/heat-shuts-down-chicago-marathon-1-man-dead-nearly-200-hospitalized) | Race "shut down early" because of intense heat; temperatures "pushed into the high 80's", breaking the 84 F record. No exact figure. |
| [The Weather Network](https://www.theweathernetwork.com/en/news/weather/severe/this-day-in-weather-history-october-7-2007-deadly-hot-chicago-marathon-2) | Heat reached 31.1 C (about 88 F; the Fahrenheit value is a conversion). Called the hottest Oct. 7 in Chicago history (a record for that date). Race cancelled about 3.5 hours after the start. |
| [CBS Chicago](https://www.cbsnews.com/amp/chicago/news/chicago-marathon-organizers-preparing-for-warm-weather) | 2007 high of 87 F; organizers cancelled the race mid-race. |

- Annotation wording used on the site: race halted mid-course because of record heat; reported highs in the upper 80s F. Nothing beyond what these sources state (for example, no cause-of-death or hospitalization numbers are used, since the sources differ).
- The sources differ by a degree or so (87 F to about 88 F), and none gives an official day's high measured the same way as the weather file.
- Charts use the weather file's values for every year, so all years come from one source. For 2007 that file gives 71.1 F at 6 AM, 75.0 F at 9 AM and 84.0 F at noon. The 84 F is a single noon reading, not the day's high.
- One summary of the CBS article mentioned a record "for October 11"; the race was on October 7, so that detail is not used.

### Wording rule for site text

The 2017 spike in slow finishers and the mid-period slowdown in median finish time are described only as what the data shows. The site does not explain their causes.

## Milestone 2 outputs

- `scripts/clean.py` -> `data/processed/results_clean.parquet` (gitignored; no names, no country) and `site/public/data/cleaning_log.json`. Raw 886,546 rows -> 886,541 clean rows; the only removals are the 5 exact duplicates (2001, 2009, 2010, 2012, 2013).
- `scripts/aggregate.py` -> `years.json`, `quantiles.json`, `density.json`, `demographics.json`, `qualifying.json` in `site/public/data/` (about 220 KB total).
- `scripts/test_outputs.py` runs 14 sanity checks, including a scan that fails if any runner name appears in `data/processed/` or `site/public/data/`.
- 2020 appears in `years.json` as `race_held: false`. The 2018-2024 qualifying label carries `assumed_mapping: true` and an assumption note inside `qualifying.json`.
- Quantiles are left null for groups under 30 finishers (37 of 567 cells; all in the 70+ and, in the 1990s, women 60-69 groups).
- Finishers beyond the 7-hour axis cap are kept in every statistic and counted in `beyond_cap` (6,868 in total; 0 in 1996, 3 in 2007, up to 959 in 2017).

## Investigation: the notch in 2022 finish times (men, about 4:12-4:15)

**What we saw.** In the 2022 distribution, men's finishers drop to almost nothing for about three minutes: per-minute counts around 4:00-4:30 run about 100-140 (4:12 has 6, 4:13 has 0, 4:14 has 0, 4:15 has 29). Women's 2022 results have a matching hole later (the 4:30-4:40 stretch has about 676 women, against 1,000-1,200 in neighboring stretches).

**What we checked.**
- **Raw vs cleaned:** identical for 2021 and 2022 by gender (the cleaning step did not create the notch).
- **Neighboring years:** 2021 and 2023 are smooth through the same minutes, and 2021 has only 35 missing place numbers (2023: 233). The notch is only in 2022; 2021 has no such notch.
- **Place numbers:** finishers are numbered in time order, so a gap in place numbers shows where in the clock results are missing. 2022 has 3,102 missing place numbers, and they fall in four solid blocks of finish time, not scattered: about 3:07-3:23 (roughly 1,000), 4:12-4:15 (about 440), 4:34-4:38 (about 530) and 5:22-5:28 (about 540). The 4:12-4:15 block matches the men's hole, and the 4:34-4:38 block matches the women's.
- **Effect on the typical time:** 2022's typical finish time is 4:21:46 from the rows present and 4:21:44 if estimated from place numbers, so the gaps barely move it.

**Conclusion (confidence: high that this is missing results, not a real feature of the race).** The notch is a gap in the source data; whole stretches of the clock are absent. The cause is unknown (the data cannot say). The main page does not explain it; it only says some 2022 results are missing.

## Figures used for the story page

| Figure | Value |
|---|---|
| Typical finish time, 1996 | 4:06:39 (shown as about 4:07) |
| Typical finish time, 2023 | 4:11:41 (shown as about 4:12) |
| Typical finish time, 2008-2018 | from 4:23 (2009) to 4:44 (2008); 2007 was 4:55 |
| Women's share of finishers, 1996 | 31.3% |
| Women's share of finishers, 2023 | 46.7% |
| Women's share, highest | 48.5% in 2017 |
| Women's share, 2007 | 39.9% (2006: 43.8%, 2008: 43.6%) |
| 2007 finishers | 25,521 in the file; the page says "about 25,000". The project owner supplied a report citing race officials that gives 24,933; I do not have a link for it, so it is not cited on the page. |
| Finishers past 7:00, 2005-2009 | 129, 171, 3, 296, 145 |

"Share of finishers" means women among those who finished, not among those who entered. 2022 is missing about 8% of results, which can nudge shares for that year.

## Analysis figures (Milestone 3 redesign)

Computed in `scripts/aggregate.py` into `site/public/data/analysis.json` and checked by `scripts/test_outputs.py`.

| Finding | Numbers |
|---|---|
| Field spread | The middle half of finishers (25th to 75th percentile) spanned 55 minutes in 1996 and 83 in 2023. The time the fastest 5% beat went from 3:05 to 2:57; the time only 5% exceeded went from 5:19 to 6:14. |
| Temperature vs typical time | 26 years (2007 plotted but left out of the fit): r = 0.70 (r-squared 0.48), about 39 seconds slower per degree F of noon temperature. Six days with noon at or above 70 F averaged a typical 4:39; six days at or below 50 F averaged 4:19. The five slowest years after 2007 (2008, 2017, 2010, 2021, 2011) all had noon temperatures of 73 F or more. Caveats: correlation, one noon reading at one station, 26 points. |
| Round-number edge | In every year more runners finished in the 5 minutes before 4:00:00 than in the 5 minutes after (ratio 1.17 to 1.63), and the same at 5:00 (1.14 to 1.73). Pooled over all years: 7,993 finishers in the 3:59 minute vs 5,905 in the 4:00 minute (26% fewer). |
| Age mix | Finishers aged 50 or over: 9% (1996) to 23% (2023). Under 30: 29% to 18%. Holding the 1996 age mix fixed, 2023's typical time would be 4:09 instead of 4:12. Every age group's typical time was 12 to 17 minutes slower in 2008-2018 than in 1996-2006. Ages are 5-year bands. |
| Dataset | 886,541 finishers (after removing 5 duplicates), 27 races (1996-2019, 2021-2023), fastest finish 2:00:35 (2023), largest field 48,155 (2023). |

### 1996 is also partial

1996's place numbers run to 9,194 but the file has 8,194 rows, so about 11% of results are missing (1,000 place numbers). The typical time is unaffected: 4:06:39 from the rows present and 4:06:39 from the middle place number. 1996 is now flagged like 2022 (partial data, excluded from finisher-count charts) and carries the on-chart note "1996: about 11% of results are missing."
