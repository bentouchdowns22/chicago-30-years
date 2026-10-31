"""Shared constants for the cleaning and aggregation scripts."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
PROCESSED = ROOT / "data" / "processed"
SITE_DATA = ROOT / "site" / "public" / "data"

# Age in the raw file is the upper edge of a 5-year band (19 = 19 and under, ..., 80 = 80+).
AGE_GROUPS = [  # (key, label, raw band values)
    ("u30", "29 and under", (19, 24, 29)),
    ("30-39", "30-39", (34, 39)),
    ("40-49", "40-49", (44, 49)),
    ("50-59", "50-59", (54, 59)),
    ("60-69", "60-69", (64, 69)),
    ("70+", "70 and over", (74, 79, 80)),
]
BAND_TO_GROUP = {band: key for key, _, bands in AGE_GROUPS for band in bands}

CAP_SECONDS = 7 * 3600          # chart axis cap (decision 3); nobody is removed
BIN_SECONDS = 120               # 2-minute density bins
FASTEST_BIN_START = 2 * 3600    # axis starts at 2:00:00
MIN_CELL = 30                   # no quantiles for groups smaller than this
PARTIAL_YEAR = 2022             # about 8% of finishers missing
NOT_COMPARABLE_YEAR = 2007      # race halted mid-course in extreme heat
NO_RACE_YEAR = 2020
ANALYSIS_PARTIAL_1996 = 1996    # about 11% of finishers missing (place numbers run past the rows)
WEATHER_FIT_EXCLUDE = 2007      # halted race: plotted but left out of the temperature fit
