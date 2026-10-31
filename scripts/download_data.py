"""Download the Chicago Marathon dataset from Kaggle into data/raw/.

Requires a free Kaggle account and credentials set up once, via either:
  - `kaggle auth login` (browser login), or
  - an API token saved at ~/.kaggle/access_token (or legacy ~/.kaggle/kaggle.json)

Usage:  python scripts/download_data.py
"""
import sys
from pathlib import Path

SLUG = "runningwithrock/chicago-marathon-results"
DEST = Path(__file__).resolve().parent.parent / "data" / "raw"


def main() -> int:
    try:
        from kaggle.api.kaggle_api_extended import KaggleApi
    except Exception as exc:  # import can itself fail when no credentials exist
        print(f"Could not load the Kaggle package: {exc}\n"
              "Install dependencies with: pip install -r requirements.txt", file=sys.stderr)
        return 1

    api = KaggleApi()
    try:
        api.authenticate()
    except Exception as exc:
        print("Kaggle authentication failed.\n"
              "Run `kaggle auth login`, or save a token from "
              "https://www.kaggle.com/settings/api to ~/.kaggle/access_token.\n"
              f"Details: {exc}", file=sys.stderr)
        return 1

    DEST.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {SLUG} -> {DEST}")
    try:
        api.dataset_download_files(SLUG, path=str(DEST), unzip=True, quiet=False)
    except Exception as exc:
        print(f"Download failed: {exc}", file=sys.stderr)
        return 1

    for f in sorted(DEST.glob("*.csv")):
        print(f"  {f.name}  ({f.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
