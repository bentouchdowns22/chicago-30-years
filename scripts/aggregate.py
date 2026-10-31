"""Build the compact JSON files the site reads, from data/processed/results_clean.parquet.

Outputs (site/public/data/): years.json, quantiles.json, density.json,
demographics.json, qualifying.json.   (cleaning_log.json comes from clean.py.)

Usage: python scripts/aggregate.py   (run clean.py first)
"""
import json
import numpy as np
import pandas as pd
from common import (RAW, PROCESSED, SITE_DATA, AGE_GROUPS, CAP_SECONDS, BIN_SECONDS,
                    FASTEST_BIN_START, MIN_CELL, PARTIAL_YEAR, NOT_COMPARABLE_YEAR, NO_RACE_YEAR)

QS = [5, 25, 50, 75, 95]
GENDERS = ["all", "M", "F"]
AGE_KEYS = ["all"] + [k for k, _, _ in AGE_GROUPS]
EDGES = np.arange(FASTEST_BIN_START, CAP_SECONDS + BIN_SECONDS, BIN_SECONDS)  # 2:00:00 .. 7:00:00


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
                        "note": "No race held in 2020; there are no results and no weather row in the data."})
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
        if y == PARTIAL_YEAR:
            entry["partial_data"] = True
            entry["note"] = ("Partial data: about 8% of finishers are missing (finisher place numbers run past "
                             "the number of rows). Fine for distribution charts, excluded from finisher-count charts.")
        if y == NOT_COMPARABLE_YEAR:
            entry["not_comparable"] = True
            entry["note"] = ("The race was halted mid-course because of record heat; reported highs were in the "
                             "upper 80s F. Times are not directly comparable to other years. The chart's weather "
                             "value comes from the same source as every other year (84 F at noon in that file, a "
                             "single reading).")
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


if __name__ == "__main__":
    main()
