"""Clean the raw results into data/processed/results_clean.parquet.

Only exact duplicate rows are removed. No finisher is dropped for a slow or fast time.
Runner names and the Country column are used (name only to find duplicates) and never written out.

Usage: python scripts/clean.py
"""
import json
import pandas as pd
from common import RAW, PROCESSED, SITE_DATA, BAND_TO_GROUP, PARTIAL_YEAR, NOT_COMPARABLE_YEAR


def main():
    raw = pd.read_csv(RAW / "Chicago Marathon Results.csv", encoding="utf-8-sig")
    n_raw = len(raw)

    # Validate and convert finish time.
    secs = pd.to_timedelta(raw["Finish Time"]).dt.total_seconds()
    assert secs.notna().all(), "unparseable finish times"
    assert (secs == raw["Finish"]).all(), "Finish Time and Finish (seconds) disagree"
    assert (secs > 0).all()
    raw["secs"] = secs.astype(int)

    # Exact duplicates: same year, name, gender, age, time and place.
    dup = raw.duplicated(subset=["Year", "Name", "Gender", "Age", "Finish Time", "Overall"], keep="first")
    log = (raw[dup].groupby("Year").size().rename("rows_removed").reset_index()
           .assign(reason="exact duplicate row"))
    df = raw[~dup].copy()

    assert set(df["Gender"]) <= {"M", "F"}
    assert set(df["Age"]) <= set(BAND_TO_GROUP), "unexpected age band"
    df["age_group"] = df["Age"].map(BAND_TO_GROUP)

    out = pd.DataFrame({
        "year": df["Year"].astype("int16"),
        "gender": df["Gender"],
        "age_band": df["Age"].astype("int16"),
        "age_group": df["age_group"],
        "secs": df["secs"].astype("int32"),
    }).reset_index(drop=True)
    PROCESSED.mkdir(parents=True, exist_ok=True)
    out.to_parquet(PROCESSED / "results_clean.parquet", index=False)

    per_year = raw.groupby("Year").size().rename("raw_rows").to_frame()
    per_year["removed"] = log.set_index("Year")["rows_removed"].reindex(per_year.index).fillna(0).astype(int)
    per_year["clean_rows"] = per_year["raw_rows"] - per_year["removed"]
    assert per_year["clean_rows"].sum() == len(out)

    summary = {
        "raw_rows": int(n_raw),
        "clean_rows": int(len(out)),
        "removed_total": int(n_raw - len(out)),
        "rules": [
            {"reason": "exact duplicate row (same year, name, gender, age, time, place)",
             "rows_removed": int(dup.sum())},
            {"reason": "slow, fast, or odd finish times: none removed (all finishers kept)", "rows_removed": 0},
        ],
        "kept_but_flagged": {
            str(PARTIAL_YEAR): "partial data: about 8% of finishers missing",
            str(NOT_COMPARABLE_YEAR): "race halted mid-course in heat; times not directly comparable",
        },
        "by_year": [{"year": int(y), **{k: int(v) for k, v in r.items()}} for y, r in per_year.iterrows()],
    }
    SITE_DATA.mkdir(parents=True, exist_ok=True)
    (SITE_DATA / "cleaning_log.json").write_text(json.dumps(summary, separators=(",", ":")))
    print(f"raw rows {n_raw:,} -> clean rows {len(out):,} (removed {n_raw - len(out)})")
    print(per_year[per_year.removed > 0].to_string())


if __name__ == "__main__":
    main()
