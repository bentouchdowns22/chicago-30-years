"""Print an audit of the raw Chicago Marathon CSVs (row counts, dtypes, missingness, per-year checks).

Usage: python scripts/audit_data.py
Names are never printed (personal data); only aggregate statistics.
"""
from pathlib import Path
import pandas as pd

RAW = Path(__file__).resolve().parent.parent / "data" / "raw"
pd.set_option("display.width", 200, "display.max_columns", 50, "display.max_rows", 200)

def load(name):
    return pd.read_csv(RAW / name, encoding="utf-8-sig", dtype=str, keep_default_na=False)

def describe(name, df):
    print(f"\n=== {name}: {len(df):,} rows x {df.shape[1]} cols ===")
    for c in df.columns:
        s = df[c]
        blank = (s.str.strip() == "").sum()
        print(f"  {c!r:20} blank={blank:>7,} ({blank/len(df):.2%})  unique={s.nunique():>7,}  e.g. {list(s.unique()[:4])}")

res = load("Chicago Marathon Results.csv")
wx = load("Chicago Marathon Weather.csv")
cq = load("Chicago Marathon Qualifying Times.csv")
for n, d in [("Results", res), ("Weather", wx), ("Qualifying", cq)]:
    describe(n, d)

print("\nRace values:", res["Race"].value_counts().to_dict())
print("Gender values:", res["Gender"].value_counts().to_dict())
print("Country top:", res["Country"].value_counts().head(8).to_dict(), " n_countries:", res["Country"].nunique())

age = pd.to_numeric(res["Age"], errors="coerce")
print("\nAge non-numeric:", age.isna().sum(), " min/max:", age.min(), age.max(), " <16:", (age < 16).sum(), " >90:", (age > 90).sum(), " ==0:", (age == 0).sum())
print("Non-numeric age raw values:", res.loc[age.isna(), "Age"].value_counts().head(5).to_dict())

# finish time parse
ft = res["Finish Time"]
pat = ft.str.fullmatch(r"\d{1,2}:\d{2}:\d{2}")
print("\nFinish Time matching H:MM:SS:", pat.sum(), " not matching:", (~pat).sum(), res.loc[~pat, "Finish Time"].value_counts().head(8).to_dict())
td = pd.to_timedelta(ft.where(pat), errors="coerce").dt.total_seconds()
res["secs"] = td
print("secs min/max:", td.min(), td.max(), " <7200 (sub-2:00):", (td < 7200).sum(), " <7200+... <=0:", (td <= 0).sum(), " >32400 (9h):", (td > 32400).sum())
fin = pd.to_numeric(res["Finish"], errors="coerce")
print("'Finish' col numeric:", fin.notna().sum(), " (looks like seconds?) corr w/ secs:", round(fin.corr(td), 4), " median diff Finish-secs:", (fin - td).median())

res["Year"] = pd.to_numeric(res["Year"], errors="coerce")
res["Overall"] = pd.to_numeric(res["Overall"], errors="coerce")
print("\nOverall non-numeric:", res["Overall"].isna().sum())

g = res.groupby("Year")
yr = pd.DataFrame({
    "rows": g.size(),
    "men": g["Gender"].apply(lambda s: (s == "M").sum()),
    "women": g["Gender"].apply(lambda s: (s == "F").sum()),
    "other_gender": g["Gender"].apply(lambda s: (~s.isin(["M", "F"])).sum()),
    "bad_time": g["secs"].apply(lambda s: s.isna().sum()),
    "bad_age": g.apply(lambda d: pd.to_numeric(d["Age"], errors="coerce").isna().sum(), include_groups=False),
    "med_min": g["secs"].median() / 60,
    "min_s": g["secs"].min(),
    "max_h": g["secs"].max() / 3600,
    "max_overall": g["Overall"].max(),
    "dup_overall": g["Overall"].apply(lambda s: s.duplicated().sum()),
})
yr["gap_vs_max_overall"] = yr["max_overall"] - yr["rows"]
print("\nPer-year:\n", yr.round(1))
print("\nYears present:", sorted(res["Year"].dropna().astype(int).unique()))

dups = res.duplicated(subset=["Year", "Name", "Gender", "Age", "Finish Time", "Overall"]).sum()
print("\nFull-duplicate rows (Year,Name,Gender,Age,Time,Overall):", dups)
print("Row-order check: is file sorted by Year?", res["Year"].is_monotonic_increasing, " years order seen:", list(dict.fromkeys(res["Year"].astype(int)))[:30])

# weather coverage
wy = set(pd.to_numeric(wx["Year"]))
ry = set(res["Year"].dropna().astype(int))
print("\nWeather years:", min(wy), max(wy), "n=", len(wy), " missing between:", sorted(set(range(min(wy), max(wy)+1)) - wy))
print("Result years without weather:", sorted(ry - wy), " weather rows outside results:", len(wy - ry))
print("Weather blanks per column:", {c: int((wx[c].str.strip() == '').sum()) for c in wx.columns})
