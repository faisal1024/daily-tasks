#!/usr/bin/env python3
"""Write a saved app state into a booted simulator, for store screenshots.

  python3 scripts/seed-screenshot-state.py <simulator-udid> <scene>

Scenes: today, evening, steps, progress, fresh (first run). The app must be
installed and NOT running; launch it afterwards. The app fills in anything
missing with its defaults, so only what a scene needs is written here.
"""

import hashlib
import json
import subprocess
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

BUNDLE = "com.faisalislam.dailytasks"
KEY = "daily-tasks/state/v1"


def day(offset=0):
    return (date.today() + timedelta(days=offset)).isoformat()


def iso(offset_days=0, hour=9):
    d = date.today() + timedelta(days=offset_days)
    return datetime(d.year, d.month, d.day, hour, tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")


PAST = [
    ["Draft the project brief", "30-minute run", "Reply to Maya"],
    ["Book the dentist", "Clean the desk", "Read 20 pages"],
    ["Outline section one", "Call the bank", "Stretch for 10 minutes"],
    ["Plan the week", "Water the plants", "Send the invoice"],
]


def history(days=23):
    hist = {}
    for i in range(days, 0, -1):
        texts = PAST[i % len(PAST)]
        done = 3 if i % 5 else 2  # mostly perfect days, a few 2/3
        hist[day(-i)] = {
            "date": day(-i),
            "total": 3,
            "completed": done,
            "locked": True,
            "lockSource": "manual",
            "tasks": [
                {"id": f"p{i}-{n}", "text": t, "completed": n < done, "carriedOver": False, "rolloverOutcome": None}
                for n, t in enumerate(texts)
            ],
            "reflection": None,
            "reflectionResult": "good",
        }
    return hist


def base(tasks, completions, locked=True):
    hist = history()
    hist[day()] = {
        "date": day(),
        "total": len(tasks),
        "completed": len(completions),
        "locked": locked,
        "lockSource": "manual" if locked else None,
        "tasks": [
            {"id": t["id"], "text": t["text"], "completed": t["id"] in completions, "carriedOver": False, "rolloverOutcome": None}
            for t in tasks
        ],
        "reflection": None,
        "reflectionResult": None,
    }
    return {
        "tasks": tasks,
        "todayCompletions": completions,
        "lastOpenedDate": day(),
        "todayLocked": locked,
        "todayLockSource": "manual" if locked else None,
        "todayLockedAt": iso(0, 8) if locked else None,
        "history": hist,
        "hasSeenOnboarding": True,
        "momentumProfile": {
            "name": "Sam",
            "goalTitle": "Run a half marathon",
            "goalSource": "custom",
            "timeAvailability": "30_min",
            "experienceLevel": "beginner",
            "struggleType": "consistency",
            "motivation": None,
            "preferredTime": "morning",
            "cadence": "daily",
            "onboardingCompletedAt": iso(-23),
        },
        "journey": {
            "xp": 900,
            "showedUpStreak": 23,
            "longestShowedUpStreak": 23,
            "showedUpFreezes": 1,
            "lastShowedUpDate": day(),
            "lastCelebratedLevel": 5,
            "awardDate": day(),
            "awardedTaskIds": completions,
            "perfectAwarded": False,
            "selectedCosmeticId": "sprout",
        },
        "completedMilestoneIds": [],
        "lastReviewPromptAt": iso(-2),
        "reviewDueAt": None,
    }


def task(tid, text, steps=None):
    t = {"id": tid, "text": text, "createdAt": iso(0, 7), "carriedOver": False}
    if steps:
        t["steps"] = steps
    return t


def scene(name):
    if name == "fresh":
        return None
    if name == "today":
        tasks = [task("t1", "Finish the quarterly report"), task("t2", "Call the dentist"), task("t3", "Plan the weekend trip")]
        return base(tasks, ["t1"])
    if name == "steps":
        steps = [
            {"id": "s1", "text": "Open last quarter's numbers", "done": True},
            {"id": "s2", "text": "Write the three headline points", "done": False},
            {"id": "s3", "text": "Draft the summary paragraph", "done": False},
        ]
        tasks = [task("t1", "Reply to Maya about Friday"), task("t2", "Finish the quarterly report", steps), task("t3", "20-minute easy run")]
        return base(tasks, ["t1"])
    if name == "evening":
        tasks = [task("t1", "Finish the quarterly report"), task("t2", "Call the dentist"), task("t3", "20-minute easy run")]
        state = base(tasks, ["t1", "t2", "t3"])
        state["todayReflectionResult"] = "good"
        state["history"][day()]["reflectionResult"] = "good"
        state["eveningClose"] = {
            "date": day(),
            "result": "good",
            "note": "All three, and the report is finally off your plate. Keep tomorrow light.",
        }
        state["tomorrowDraft"] = {
            "forDate": day(1),
            "tasks": ["Send the report to Priya", "Book the physio", "25-minute easy run"],
            "note": "All three, and the report is finally off your plate. Keep tomorrow light.",
            "because": "Because today went well: one follow-up, one errand, one run.",
            "source": "ai",
        }
        state["coachMemory"] = "Finishes work tasks early in the day; runs go better after 5 pm."
        return state
    if name == "progress":
        tasks = [task("t1", "Finish the quarterly report"), task("t2", "Call the dentist"), task("t3", "Plan the weekend trip")]
        state = base(tasks, ["t1", "t2"])
        state["completedMilestoneIds"] = ["milestone_start"]
        return state
    raise SystemExit(f"unknown scene {name}")


def main():
    udid, name = sys.argv[1], sys.argv[2]
    container = subprocess.check_output(
        ["xcrun", "simctl", "get_app_container", udid, BUNDLE, "data"], text=True
    ).strip()
    folder = Path(container) / "Library" / "Application Support" / BUNDLE / "RCTAsyncLocalStorage_V1"
    folder.mkdir(parents=True, exist_ok=True)
    manifest_path = folder / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    # Start clean: drop every stored key (state, backup, counters).
    for child in folder.iterdir():
        if child.name != "manifest.json":
            child.unlink()
    manifest = {}
    state = scene(name)
    if state is not None:
        value = json.dumps(state)
        (folder / hashlib.md5(KEY.encode()).hexdigest()).write_text(value)
        manifest[KEY] = None
    manifest_path.write_text(json.dumps(manifest))
    print(f"seeded {name} into {folder}")


if __name__ == "__main__":
    main()
