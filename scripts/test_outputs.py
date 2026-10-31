"""Sanity checks for the cleaned and aggregated data. Exits non-zero if any check fails.

Usage: python scripts/test_outputs.py   (needs data/raw/ plus the outputs of clean.py and aggregate.py)
"""
import json
import re
import sys
import pandas as pd
from common import RAW, PROCESSED, SITE_DATA, AGE_GROUPS, CAP_SECONDS, PARTIAL_YEAR, NOT_COMPARABLE_YEAR, NO_RACE_YEAR

BUDGET_BYTES = 5 * 1024 * 1024
results = []


def check(name):
    def deco(fn):
        try:
            fn()
            results.append((name, True, ""))
        except Exception as e:  # noqa: BLE001 - report any failure
            results.append((name, False, f"{type(e).__name__}: {e}"))
        return fn
    return deco


def load(name):
    return json.loads((SITE_DATA / name).read_text())


df = pd.read_parquet(PROCESSED / "results_clean.parquet")
years = load("years.json")["years"]
held = [y for y in years if y["race_held"]]


@check("row counts reconcile: raw - removed = clean")
def _():
    log = load("cleaning_log.json")
    raw_rows = len(pd.read_csv(RAW / "Chicago Marathon Results.csv", encoding="utf-8-sig", usecols=["Year"]))
    assert log["raw_rows"] == raw_rows
    assert log["raw_rows"] - log["removed_total"] == log["clean_rows"] == len(df)


@check("exactly 5 duplicate rows were removed")
def _():
    assert load("cleaning_log.json")["removed_total"] == 5


@check("yearly finisher counts match the cleaned data")
def _():
    counts = df.groupby("year").size()
    for y in held:
        assert y["finishers"] == counts[y["year"]], y["year"]
        assert y["men"] + y["women"] == y["finishers"], y["year"]
    assert sum(y["finishers"] for y in held) == len(df)


@check("2020 is an explicit no-race entry; every other year 1996-2023 is a race year")
def _():
    by = {y["year"]: y for y in years}
    assert sorted(by) == list(range(1996, 2024))
    assert by[NO_RACE_YEAR]["race_held"] is False and by[NO_RACE_YEAR]["finishers"] is None
    assert all(by[y]["race_held"] for y in by if y != NO_RACE_YEAR)


@check("2022 is flagged partial and excluded from count charts; 2007 flagged not comparable")
def _():
    by = {y["year"]: y for y in years}
    assert by[PARTIAL_YEAR]["partial_data"] and not by[PARTIAL_YEAR]["show_in_count_charts"]
    assert by[NOT_COMPARABLE_YEAR]["not_comparable"] and len(by[NOT_COMPARABLE_YEAR]["sources"]) == 4
    assert {y["year"] for y in held if not y["show_in_count_charts"]} == {1996, PARTIAL_YEAR}
    assert by[1996]["partial_data"] and "11%" in by[1996]["short_note"]


@check("every race year has weather")
def _():
    for y in held:
        assert y["weather"] and all(v is not None for v in y["weather"].values()), y["year"]


@check("quantiles rise from p5 to p95 and are only null for small groups")
def _():
    qd = load("quantiles.json")
    for r in qd["rows"]:
        ps = [r[f"p{q}"] for q in (5, 25, 50, 75, 95)]
        if r["n"] < qd["min_group_size"]:
            assert all(p is None for p in ps), r
        else:
            assert all(p is not None for p in ps) and ps == sorted(ps) and len(set(ps)) == 5, r


@check("quantile group sizes add up (men + women = all; age groups = all)")
def _():
    rows = load("quantiles.json")["rows"]
    n = {(r["year"], r["gender"], r["age_group"]): r["n"] for r in rows}
    for y in {r["year"] for r in rows}:
        assert n[(y, "M", "all")] + n[(y, "F", "all")] == n[(y, "all", "all")]
        assert sum(n[(y, "all", k)] for k, _, _ in AGE_GROUPS) == n[(y, "all", "all")]


@check("density: shares plus beyond-cap finishers add up to 1; beyond-cap matches years.json")
def _():
    dd = load("density.json")
    by = {y["year"]: y for y in years}
    for r in dd["rows"]:
        assert len(r["share"]) == dd["bins"]
        total = sum(r["share"]) + r["beyond_cap"] / r["n"]
        assert abs(total - 1) < 1e-3, (r["year"], r["gender"], total)
        if r["gender"] == "all":
            assert r["beyond_cap"] == by[r["year"]]["beyond_cap"]
    assert dd["cap_seconds"] == CAP_SECONDS


@check("demographics: shares sum to 1 per year; counts match finishers")
def _():
    rows = load("demographics.json")["rows"]
    by = {y["year"]: y for y in held}
    for yr in by:
        part = [r for r in rows if r["year"] == yr]
        assert abs(sum(r["share"] for r in part) - 1) < 1e-4, yr
        assert sum(r["n"] for r in part) == by[yr]["finishers"], yr


@check("qualifying: 3 standards, 24 rows each, 2018-2024 label carries the assumption flag")
def _():
    st = {s["id"]: s for s in load("qualifying.json")["standards"]}
    assert set(st) == {"2014", "2018_2024", "2025"}
    assert all(len(s["times"]) == 24 for s in st.values())
    assert st["2018_2024"]["assumed_mapping"] is True and "ASSUMPTION" in st["2018_2024"]["assumption_note"]
    assert st["2018_2024"]["label"] == "2018-2024 standard (file column: 2024)"
    assert not st["2014"]["assumed_mapping"] and not st["2025"]["assumed_mapping"]


@check("story numbers on the page match the data (typical time, women's share, 2007, 2017)")
def _():
    q = {(r["year"], r["gender"]): r for r in load("quantiles.json")["rows"] if r["age_group"] == "all"}
    assert round(q[(1996, "all")]["p50"] / 60) == 247 and round(q[(2023, "all")]["p50"] / 60) == 252  # 4:07 and 4:12
    share = {y["year"]: y["women"] / y["finishers"] for y in held}
    assert round(share[1996] * 100) == 31 and round(share[2023] * 100) == 47
    assert max(share, key=share.get) == 2017 and round(share[2017] * 100, 1) == 48.5
    assert share[2007] < share[2006] and share[2007] < share[2008] and round(share[2007] * 100, 1) == 39.9
    by = {y["year"]: y for y in held}
    assert by[2007]["finishers"] == 25521 and round(q[(2007, "all")]["p50"] / 60) == 295
    mid = [q[(yr, "all")]["p50"] / 60 for yr in range(2008, 2019)]
    assert round(min(mid)) == 263 and round(max(mid)) == 284  # 4:23 to 4:44


def analysis():
    return load("analysis.json")


@check("analysis: the field spread out (middle half 55 -> 83 minutes; tails move outward)")
def _():
    sp = {r["year"]: r for r in analysis()["spread"]}
    assert round(sp[1996]["middle_half"] / 60) == 55 and round(sp[2023]["middle_half"] / 60) == 83
    assert sp[2023]["p5"] < sp[1996]["p5"] and sp[2023]["p95"] > sp[1996]["p95"]
    assert all(r["p5"] < r["p25"] < r["p50"] < r["p75"] < r["p95"] for r in sp.values())


@check("analysis: temperature vs typical time (n=26, r about 0.70, 2007 plotted but not fitted)")
def _():
    w = analysis()["weather"]
    assert w["n"] == 26 and round(w["r"], 2) == 0.70 and 0.45 < w["r_squared"] < 0.5
    assert [p for p in w["points"] if p["year"] == 2007][0]["in_fit"] is False and sum(p["in_fit"] for p in w["points"]) == 26
    assert round(w["slope_seconds_per_degree"]) == 39
    assert {p["year"] for p in w["five_slowest_years_excluding_2007"]} == {2008, 2010, 2011, 2017, 2021}
    assert all(p["noon_temp"] >= 73 for p in w["five_slowest_years_excluding_2007"])
    assert round(w["warm_days"]["average_typical"] / 60) == 279 and round(w["cool_days"]["average_typical"] / 60) == 259


@check("analysis: more finishers just before 4:00 and 5:00 than just after, in every year")
def _():
    r = analysis()["round_numbers"]
    for h in ("4", "5"):
        assert all(v > 1 for v in r["before_after_ratio"][h].values()), h
    v4 = list(r["before_after_ratio"]["4"].values())
    assert round(min(v4), 2) == 1.17 and round(max(v4), 2) == 1.63
    assert r["minute_3_59"] == 7993 and r["minute_4_00"] == 5905 and round(r["drop_share"], 2) == 0.26


@check("analysis: age mix (50+ 9% -> 23%, under 30 29% -> 18%) and 1996-age-mix typical time about 4:09 in 2023")
def _():
    a = analysis()["age"]
    mix = {r["year"]: r for r in a["mix"]}
    assert round(mix[1996]["50+"] * 100) == 9 and round(mix[2023]["50+"] * 100) == 23
    assert round(mix[1996]["u30"] * 100) == 29 and round(mix[2023]["u30"] * 100) == 18
    assert all(abs(sum(v for k, v in r.items() if k != "year") - 1) < 1e-3 for r in a["mix"])
    s = {r["year"]: r for r in a["standardized"]}
    assert abs(s[2023]["typical_1996_age_mix"] / 60 - 249.5) < 0.6
    per = a["typical_by_age_group_by_period"]
    gaps = [(v["2008-2018"] - v["1996-2006"]) / 60 for v in per.values()]
    assert round(min(gaps)) == 12 and round(max(gaps)) == 17


@check("analysis: dataset numbers (886,541 finishers, 27 races, fastest 2:00:35 in 2023)")
def _():
    d = analysis()["dataset"]
    assert d["finishers"] == len(df) == 886541 and d["races"] == 27
    assert d["fastest_seconds"] == 7235 and d["fastest_year"] == 2023 and d["largest_year"] == 2023


@check("total size of committed data files is under 5 MB")
def _():
    total = sum(p.stat().st_size for p in SITE_DATA.rglob("*") if p.is_file())
    assert total < BUDGET_BYTES, f"{total:,} bytes"


# ---- privacy: no runner name may appear in processed or site data -------------------
def corpus_text(paths):
    parts = []
    for p in paths:
        if p.suffix == ".parquet":
            d = pd.read_parquet(p)
            parts.append(" ".join(d.columns))
            for c in d.select_dtypes(include=["object", "string"]).columns:
                parts.extend(d[c].dropna().astype(str).unique())
        elif p.suffix in (".json", ".csv", ".txt", ".md", ".geojson"):
            parts.append(p.read_text(errors="ignore"))
    return "\n".join(parts).lower()


def names_found(text, names):
    """Names (2+ words) whose every word appears in the text, confirmed by a full-name substring match."""
    vocab = set(re.findall(r"[a-z]{2,}", text))
    hits = []
    for nm in names:
        words = re.findall(r"[a-z]{2,}", nm.lower())
        if len(words) >= 2 and all(w in vocab for w in words) and nm.lower() in text:
            hits.append(nm)
    return hits


@check("privacy: no runner name appears in data/processed/ or site/public/data/")
def _():
    names = pd.read_csv(RAW / "Chicago Marathon Results.csv", encoding="utf-8-sig", usecols=["Name"])["Name"]
    names = names.dropna().astype(str).str.strip().unique()
    paths = [p for d in (PROCESSED, SITE_DATA) for p in d.rglob("*") if p.is_file()]
    assert paths, "no files found to scan"
    hits = names_found(corpus_text(paths), names)
    assert not hits, f"{len(hits)} runner names found, e.g. {hits[:3]}"


@check("privacy scan self-test: it does catch a planted name")
def _():
    names = ["Greg McCarter", "Marcos De Sa"]
    assert names_found("some json {\"who\":\"greg mccarter\"}".lower(), names) == ["Greg McCarter"]
    assert names_found("clean file with no people", names) == []


width = max(len(n) for n, _, _ in results)
for name, ok, msg in results:
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"\n      {msg}" if msg else ""))
failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)
