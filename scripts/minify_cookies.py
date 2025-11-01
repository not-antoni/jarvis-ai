#!/usr/bin/env python3

"""Utility to minify cookie exports for yt-dlp environment variables.

Render/yt-dlp expect a single-line JSON string when cookies are provided via
environment variables. This script can read the `YTDLP_COOKIES_JSON`
environment variable or a Chrome/Firefox style export and prints the compact
representation so it can be pasted into `YTDLP_COOKIES_JSON`,
`YT_COOKIES_JSON`, etc.
"""

from __future__ import annotations

import argparse
import os
import json
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Minify a YouTube cookies JSON export for env usage."
    )
    parser.add_argument(
        "--env",
        default="YTDLP_COOKIES_JSON",
        help=(
            "Name of the env variable to read (default: YTDLP_COOKIES_JSON). "
            "If the variable is empty, falls back to the positional file argument."
        ),
    )
    parser.add_argument(
        "input",
        nargs="?",
        default="cookies.json",
        help="Path to the cookie JSON export (default: cookies.json)",
    )
    return parser.parse_args()


def load_cookie_from_env(name: str) -> object | None:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return None

    try:
        return json.loads(raw)
    except json.JSONDecodeError as primary_error:
        if "\\n" in raw or "\\t" in raw:
            try:
                normalized = raw.encode("utf-8").decode("unicode_escape")
                return json.loads(normalized)
            except Exception as secondary_error:
                raise SystemExit(
                    f"Invalid JSON in ${name}: {secondary_error}"
                ) from secondary_error
        raise SystemExit(f"Invalid JSON in ${name}: {primary_error}") from primary_error


def load_cookie_file(path: Path) -> object:
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError:
        raise SystemExit(f"Cookie file not found: {path}")
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid JSON in {path}: {exc}") from exc


def main() -> None:
    args = parse_args()
    data = load_cookie_from_env(args.env)
    if data is None:
        data = load_cookie_file(Path(args.input))

    json.dump(data, sys.stdout, separators=(",", ":"))
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
