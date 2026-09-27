#!/usr/bin/env python3
"""Rebuild store.config.json (EAS Metadata) from docs/app-store-listing.md.

  python3 scripts/build-store-config.py

The doc is the source of truth; run this after editing it (a test checks they match).
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
md = (ROOT / "docs" / "app-store-listing.md").read_text()


def block(heading):
    i = md.index(heading)
    j = md.index("```", i) + 3
    k = md.index("```", j)
    return md[j:k].strip("\n")


cfg = {
    "configVersion": 0,
    "apple": {
        "copyright": "2026 Faisal Islam",
        "info": {
            "en-US": {
                "title": "Three Today: 3 Tasks a Day",
                "subtitle": "Brain dump to your daily three",
                "description": block("## Description"),
                "keywords": block("## Keywords").split(","),
                "releaseNotes": block("## What's New in 1.1.0"),
                "promoText": block("## Promotional text"),
                "privacyPolicyUrl": "https://gist.githubusercontent.com/faisal1024/a43d6373453761af70d495d640e38ffa/raw/privacy-policy.html",
                "supportUrl": "https://github.com/faisal1024/daily-tasks#support",
            }
        },
        "review": {"notes": block("## App Review notes"), "demoRequired": False},
    },
}
(ROOT / "store.config.json").write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + "\n")
print("store.config.json rebuilt")
