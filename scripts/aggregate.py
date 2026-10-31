"""Build the compact JSON files the site reads, from data/processed/results_clean.parquet.

Outputs (site/public/data/): years.json, quantiles.json, density.json,
demographics.json, qualifying.json.   (cleaning_log.json comes from clean.py.)

Usage: python scripts/aggregate.py   (run clean.py first)
"""
import json
import numpy as np
import pandas as pd
from common import (RAW, PROCESSED, SITE_DATA, AGE_GROUPS, CAP_SECONDS, BIN_SECONDS,
                    FASTEST_BIN_START, MIN_CELL, PARTIAL_YEAR, NOT_COMPARABLE_YEAR, NO_RACE_YEAR,
                    ANALYSIS_PARTIAL_1996, WEATHER_FIT_EXCLUDE)

QS = [5, 25, 50, 75, 95]
GENDERS = ["all", "M", "F"]
AGE_KEYS = ["all"] + [k for k, _, _ in AGE_GROUPS]
EDGES = np.arange(FASTEST_BIN_START, CAP_SECONDS + BIN_SECONDS, BIN_SECONDS)  # 2:00:00 .. 7:00:00


def fmt_clock(s):
    s = round(s)
    return f"{s // 3600}:{s % 3600 // 60:02d}:{s % 60:02d}"


def dump(name, obj):
    path = SITE_DATA / name
    path.write_text(json.dumps(obj, separators=(",", ":")))
    print(f"  {name}: {path.stat().st_size:,} bytes")


def subset(d, gender, age):
    if gender != "all":
        d = d[d.gender == gender]
    if age != "all":
        d = d[d.age_group == age]
    return d


def place_check(year):
    """How many place numbers are missing, and does the typical time hold up if we use place numbers instead of rows?"""
    raw = pd.read_csv(RAW / "Chicago Marathon Results.csv", encoding="utf-8-sig", usecols=["Year", "Overall", "Finish"])
    d = raw[raw.Year == year].sort_values("Overall")
    rows, top = len(d), int(d.Overall.max())
    mid_row = d.iloc[(d.Overall - top / 2).abs().argsort().iloc[:1]]
    return {"rows": rows, "max_place": top, "missing": top - rows, "missing_share": (top - rows) / top,
            "typical_rows": float(d.Finish.median()), "typical_by_place": float(mid_row.Finish.iloc[0])}


def weighted_median(values, weights):
    o = np.argsort(values)
    v, w = values[o], weights[o]
    return float(v[np.searchsorted(np.cumsum(w) / w.sum(), 0.5)])


def main():
    SITE_DATA.mkdir(parents=True, exist_ok=True)
    df = pd.read_parquet(PROCESSED / "results_clean.parquet")
    wx = pd.read_csv(RAW / "Chicago Marathon Weather.csv", encoding="utf-8-sig").set_index("Year")
    years = list(range(int(df.year.min()), int(df.year.max()) + 1))
    assert NO_RACE_YEAR in years and NO_RACE_YEAR not in set(df.year)

    # ---- years.json -------------------------------------------------------------
    yrs = []
    for y in years:
        if y == NO_RACE_YEAR:
            yrs.append({"year": y, "race_held": False, "finishers": None, "men": None, "women": None,
                        "beyond_cap": None, "weather": None, "date": None,
                        "show_in_count_charts": False,
                        "note": "No race was held in 2020, so there is nothing to show for this year.",
                        "short_note": "2020: no race",
                        "detail_note": "No race held in 2020; there are no results and no weather row in the data."})
            continue
        d = df[df.year == y]
        w = wx.loc[y]
        entry = {
            "year": y, "race_held": True,
            "date": w["Date"],
            "finishers": int(len(d)),
            "men": int((d.gender == "M").sum()),
            "women": int((d.gender == "F").sum()),
            "beyond_cap": int((d.secs > CAP_SECONDS).sum()),
            "weather": {"units": "degrees F and mph (assumed; the file does not state units)",
                        "temp_6am": w["6AM Temp"], "temp_9am": w["9AM Temp"], "temp_noon": w["12PM Temp"],
                        "dew_6am": w["6AM Dew"], "dew_9am": w["9AM Dew"], "dew_noon": w["12PM Dew"],
                        "wind_6am": w["6AM Wind"], "wind_9am": w["9AM Wind"], "wind_noon": w["12PM Wind"]},
            "show_in_count_charts": y != PARTIAL_YEAR,
            "note": None,
        }
        if y == ANALYSIS_PARTIAL_1996:
            pc = place_check(y)
            entry["partial_data"] = True
            entry["show_in_count_charts"] = False
            entry["note"] = (f"Some results are missing: about {round(pc['missing_share'] * 100)}% of finishers (roughly 1 in 9) "
                             "are not in the data, so this year's hill covers most, but not all, of the runners. "
                             "The typical finish time is not affected.")
            entry["short_note"] = f"1996: about {round(pc['missing_share'] * 100)}% of results are missing."
            entry["detail_note"] = (f"Partial data: finisher place numbers run to {pc['max_place']:,} but the file has {pc['rows']:,} rows "
                                    f"({pc['missing']:,} missing). The typical time is {fmt_clock(pc['typical_rows'])} from the rows present and "
                                    f"{fmt_clock(pc['typical_by_place'])} using the middle place number, so the gaps do not move it.")
        if y == PARTIAL_YEAR:
            entry["partial_data"] = True
            entry["note"] = ("Some results are missing: about 8% of finishers (roughly 1 in 12) are not in the data, "
                             "so this year's hill covers most, but not all, of the runners.")
            entry["short_note"] = "2022: about 8% of results are missing."
            entry["detail_note"] = ("Partial data: finisher place numbers run past the number of rows (about 3,100 gaps). "
                                    "The year stays in the distribution chart and is excluded from any chart of finisher counts.")
        if y == NOT_COMPARABLE_YEAR:
            entry["not_comparable"] = True
            entry["note"] = ("Record heat stopped this race partway through (reported highs were in the upper 80s F), "
                             "so these times can't be fairly compared with other years. The temperature shown here is "
                             "one reading at noon, so it can be lower than the day's reported high.")
            entry["short_note"] = "2007: record heat stopped the race partway. Times can't be fairly compared."
            entry["detail_note"] = ("The race was halted mid-course because of record heat; reported highs were in the upper "
                                    "80s F. The chart's weather value comes from the same source as every other year "
                                    "(84 F at noon in that file, a single reading), so it can differ from the reported high.")
            entry["sources"] = [
                "https://www.npr.org/2007/10/08/15091688/heat-mars-weekend-marathons-two-die",
                "https://www.wbez.org/2007/10/07/heat-shuts-down-chicago-marathon-1-man-dead-nearly-200-hospitalized",
                "https://www.theweathernetwork.com/en/news/weather/severe/this-day-in-weather-history-october-7-2007-deadly-hot-chicago-marathon-2",
                "https://www.cbsnews.com/amp/chicago/news/chicago-marathon-organizers-preparing-for-warm-weather"]
        yrs.append(entry)
    dump("years.json", {"axis_cap_seconds": CAP_SECONDS, "years": yrs})

    # ---- quantiles.json ---------------------------------------------------------
    rows = []
    for y in years:
        if y == NO_RACE_YEAR:
            continue
        dy = df[df.year == y]
        for g in GENDERS:
            for a in AGE_KEYS:
                s = subset(dy, g, a).secs
                r = {"year": y, "gender": g, "age_group": a, "n": int(len(s))}
                if len(s) >= MIN_CELL:
                    for q, v in zip(QS, np.percentile(s, QS)):
                        r[f"p{q}"] = round(float(v))
                else:
                    r.update({f"p{q}": None for q in QS})
                rows.append(r)
    dump("quantiles.json", {"unit": "seconds", "min_group_size": MIN_CELL,
                            "note": "Quantiles are null when a group has fewer than min_group_size finishers.",
                            "rows": rows})

    # ---- density.json -----------------------------------------------------------
    dens = []
    for y in years:
        if y == NO_RACE_YEAR:
            continue
        dy = df[df.year == y]
        for g in GENDERS:
            s = subset(dy, g, "all").secs.to_numpy()
            assert s.min() >= FASTEST_BIN_START
            inside = s[s <= CAP_SECONDS]
            counts, _ = np.histogram(inside, bins=EDGES)
            dens.append({"year": y, "gender": g, "n": int(len(s)),
                         "beyond_cap": int((s > CAP_SECONDS).sum()),
                         "share": [round(float(c) / len(s), 6) for c in counts]})
    dump("density.json", {"start_seconds": FASTEST_BIN_START, "bin_seconds": BIN_SECONDS,
                          "cap_seconds": CAP_SECONDS, "bins": len(EDGES) - 1,
                          "note": "share = fraction of ALL that year's finishers in each bin; finishers past the cap are counted in beyond_cap, not dropped.",
                          "rows": dens})

    # ---- demographics.json ------------------------------------------------------
    demo = []
    for y in years:
        if y == NO_RACE_YEAR:
            continue
        dy = df[df.year == y]
        for g in ["M", "F"]:
            for k, label, _ in AGE_GROUPS:
                n = int(((dy.gender == g) & (dy.age_group == k)).sum())
                demo.append({"year": y, "gender": g, "age_group": k, "n": n, "share": round(n / len(dy), 6)})
    dump("demographics.json", {"age_groups": [{"key": k, "label": l} for k, l, _ in AGE_GROUPS],
                               "note": "share = fraction of that year's finishers. Ages in the source are 5-year bands, so 'u30' means 29 and under.",
                               "rows": demo})

    # ---- qualifying.json --------------------------------------------------------
    q = pd.read_csv(RAW / "Chicago Marathon Qualifying Times.csv", encoding="utf-8-sig")
    standards = [
        {"id": "2014", "label": "2014 standard", "file_column": "2014 CQ", "assumed_mapping": False},
        {"id": "2018_2024", "label": "2018-2024 standard (file column: 2024)", "file_column": "2024 CQ",
         "assumed_mapping": True,
         "assumption_note": ("ASSUMPTION, NOT YET CONFIRMED: the file labels this column '2024'. Based on an outside "
                             "source, we treat it as the standard in force from 2018 to 2024. Confirm before "
                             "presenting it as fact.")},
        {"id": "2025", "label": "2025 standard", "file_column": "2025 CQ", "assumed_mapping": False},
    ]
    for s in standards:
        s["times"] = [{"gender": r["Gender"], "age_group": r["Chicago Age"], "seconds": int(r[s["file_column"]])}
                      for _, r in q.iterrows()]
    dump("qualifying.json", {"unit": "seconds", "standards": standards})
    dump("analysis.json", build_analysis(df, wx, years))


def build_analysis(df, wx, years):
    held = [y for y in years if y != NO_RACE_YEAR]
    g = df.groupby("year").secs

    # --- spread: how wide the field is, year by year
    spread = [{"year": y, **{f"p{q}": round(float(np.percentile(df[df.year == y].secs, q))) for q in QS}} for y in held]
    for r in spread:
        r["middle_half"] = r["p75"] - r["p25"]

    # --- temperature vs typical time (2007 plotted, not fitted)
    pts = [{"year": y, "noon_temp": float(wx.loc[y, "12PM Temp"]), "typical": float(g.median()[y]), "in_fit": y != WEATHER_FIT_EXCLUDE} for y in held]
    fit = [p for p in pts if p["in_fit"]]
    xs, ys = np.array([p["noon_temp"] for p in fit]), np.array([p["typical"] for p in fit])
    slope, intercept = np.polyfit(xs, ys, 1)
    r = float(np.corrcoef(xs, ys)[0, 1])
    warm = [p["typical"] for p in fit if p["noon_temp"] >= 70]
    cool = [p["typical"] for p in fit if p["noon_temp"] <= 50]
    slowest = sorted(fit, key=lambda p: -p["typical"])[:5]
    weather = {"points": pts, "n": len(fit), "r": round(r, 5), "r_squared": round(r * r, 5),
               "slope_seconds_per_degree": round(float(slope), 2), "intercept_seconds": round(float(intercept), 1),
               "warm_days": {"rule": "noon temperature at or above 70", "n": len(warm), "average_typical": round(float(np.mean(warm)))},
               "cool_days": {"rule": "noon temperature at or below 50", "n": len(cool), "average_typical": round(float(np.mean(cool)))},
               "five_slowest_years_excluding_2007": [{"year": p["year"], "noon_temp": p["noon_temp"]} for p in slowest],
               "note": "Correlation, not proof. Temperature is one noon reading at one station; 2007 (halted race) is plotted but left out of the fit."}

    # --- round-number edges: 5 minutes before vs after a landmark time
    def ratio(y, t):
        s = df[df.year == y].secs
        return float(((s >= t - 300) & (s < t)).sum()) / max(1, int(((s >= t) & (s < t + 300)).sum()))
    ratios = {str(h): {y: round(ratio(y, h * 3600), 3) for y in held} for h in (4, 5)}
    s_all = df.secs
    start_min = 225  # 3:45
    pooled = [int(((s_all >= m * 60) & (s_all < (m + 1) * 60)).sum()) for m in range(start_min, start_min + 31)]
    c359, c400 = pooled[239 - start_min], pooled[240 - start_min]
    round_numbers = {"before_after_ratio": ratios, "pooled_start_minute": start_min, "pooled_counts_per_minute": pooled,
                     "minute_3_59": c359, "minute_4_00": c400, "drop_share": round(1 - c400 / c359, 3),
                     "note": "Ratio = finishers in the 5 minutes before the landmark / finishers in the 5 minutes after."}

    # --- age: mix over time, and typical time with the 1996 age mix held fixed (ignores gender)
    ag = {"u30": ["u30"], "30-39": ["30-39"], "40-49": ["40-49"], "50+": ["50-59", "60-69", "70+"]}
    mix = [{"year": y, **{k: round(float(df[(df.year == y)].age_group.isin(v).mean()), 4) for k, v in ag.items()}} for y in held]
    w96 = df[df.year == 1996].age_group.value_counts(normalize=True)
    std = []
    for y in held:
        d = df[df.year == y]
        vals = [d[d.age_group == k].secs.to_numpy() for k in w96.index]
        wts = [np.full(len(v), w96[k] / len(v)) for k, v in zip(w96.index, vals)]
        std.append({"year": y, "typical_actual": float(d.secs.median()), "typical_1996_age_mix": round(weighted_median(np.concatenate(vals), np.concatenate(wts)))})
    periods = {"1996-2006": range(1996, 2007), "2008-2018": range(2008, 2019), "2019-2023": [2019, 2021, 2022, 2023]}
    by_age = {k: {pn: round(float(np.mean([df[(df.year == y) & (df.age_group == k)].secs.median() for y in yy]))) for pn, yy in periods.items()}
              for k in ["u30", "30-39", "40-49", "50-59", "60-69"]}
    age = {"mix": mix, "standardized": std, "typical_by_age_group_by_period": by_age,
           "note": "Ages in the source are 5-year bands. 50+ = 50-59, 60-69 and 70 and over."}
    # --- the dataset in a few numbers (for the intro)
    sizes = df.groupby("year").size()
    fastest = df.loc[df.secs.idxmin()]
    dataset = {"finishers": int(len(df)), "races": len(held), "first_year": int(min(held)), "last_year": int(max(held)),
               "no_race_year": NO_RACE_YEAR, "fastest_seconds": int(fastest.secs), "fastest_year": int(fastest.year),
               "largest_year": int(sizes.idxmax()), "largest_finishers": int(sizes.max()),
               "note": "finishers = rows after removing 5 exact duplicates; names are never used or published"}
    return {"dataset": dataset, "spread": spread, "weather": weather, "round_numbers": round_numbers, "age": age}


if __name__ == "__main__":
    main()
