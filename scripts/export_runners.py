"""Write one small JSON file per year with individual finishers, for the "random runner" button.

Output: site/public/data/runners/<year>.json  ({"year": Y, "rows": [[name, gender, age_band, country, secs], ...]})
and site/public/data/runners/index.json (finisher count per year, so the page can pick a runner uniformly).
Names come from the public results; this is the only place they are written out.
The page loads one year's file only when the button is pressed.

Usage: python scripts/export_runners.py
"""
import json
import re
from collections import defaultdict
import pandas as pd
from common import RAW, SITE_DATA

OUT = SITE_DATA / "runners"


def main():
    raw = pd.read_csv(RAW / "Chicago Marathon Results.csv", encoding="utf-8-sig")
    raw = raw.drop_duplicates(subset=["Year", "Name", "Gender", "Age", "Finish Time", "Overall"])
    raw = raw[raw["Name"].fillna("").str.strip() != ""]
    OUT.mkdir(parents=True, exist_ok=True)
    counts = {}
    for year, g in raw.groupby("Year"):
        # Country has scraping junk in some years; keep only clean 3-letter uppercase codes.
        country = g["Country"].fillna("").where(g["Country"].fillna("").str.fullmatch(r"[A-Z]{3}"), "")
        rows = [[re.sub(r"\s+", " ", n).strip(), s, int(a), c, int(t)]
                for n, s, a, c, t in zip(g["Name"], g["Gender"], g["Age"], country, g["Finish"])]
        (OUT / f"{year}.json").write_text(json.dumps({"year": int(year), "rows": rows}, separators=(",", ":"), ensure_ascii=False))
        counts[str(int(year))] = len(rows)
    (OUT / "index.json").write_text(json.dumps({"counts": counts}, separators=(",", ":")))
    print(f"{sum(counts.values()):,} runners in {len(counts)} files")


if __name__ == "__main__":
    main()
