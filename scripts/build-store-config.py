#!/usr/bin/env python3
"""Rebuild store.config.json (EAS Metadata) from docs/app-store-listing.md.

  python3 scripts/build-store-config.py                    # no What's New yet
  python3 scripts/build-store-config.py --until 2026-12-15 # with What's New

The doc is the source of truth; run this after editing it (tests check they
match). What's New has a "<date>" for the early-supporter deadline
(GRANDFATHER_GRANTS_UNTIL on the server), so it's only written once --until
fills it in. Existing fields this script doesn't manage (categories, age
rating, review contact from `eas metadata:pull`) are kept.
"""

import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
md = (ROOT / "docs" / "app-store-listing.md").read_text()
out = ROOT / "store.config.json"


def block(heading):
    i = md.index(heading)
    j = md.index("```", i) + 3
    k = md.index("```", j)
    return md[j:k].strip("\n")


def name_row(field):
    # "| Name | **Three Today: 3 Tasks a Day** | 26 / 30 |"
    line = next(l for l in md.splitlines() if l.startswith(f"| {field} |"))
    return line.split("**")[1]


until = None
if "--until" in sys.argv:
    until = date.fromisoformat(sys.argv[sys.argv.index("--until") + 1])

cfg = json.loads(out.read_text()) if out.exists() else {"configVersion": 0}
apple = cfg.setdefault("apple", {})
apple["copyright"] = "2026 Faisal Islam"
info = apple.setdefault("info", {}).setdefault("en-US", {})
info.update(
    {
        "title": name_row("Name"),
        "subtitle": name_row("Subtitle"),
        "description": block("## Description"),
        "keywords": block("## Keywords").split(","),
        "promoText": block("## Promotional text"),
        "privacyPolicyUrl": "https://gist.githubusercontent.com/faisal1024/a43d6373453761af70d495d640e38ffa/raw/privacy-policy.html",
        "supportUrl": "https://github.com/faisal1024/daily-tasks#support",
    }
)
if until:
    info["releaseNotes"] = block("## What's New in 1.1.0").replace("<date>", f"{until:%B} {until.day}, {until.year}")
else:
    info.pop("releaseNotes", None)
review = apple.setdefault("review", {})
review.update({"notes": block("## App Review notes"), "demoRequired": False})
out.write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + "\n")
print("store.config.json rebuilt" + ("" if until else " (no What's New: pass --until YYYY-MM-DD)"))
