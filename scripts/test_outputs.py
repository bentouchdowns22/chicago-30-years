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
    assert by[NOT_COMPARABLE_YEAR]["not_comparable"] and len(by[NOT_COMPARABLE_YEAR]["sources"]) == 2
    assert sum(not y["show_in_count_charts"] for y in held) == 1


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
