// Nag mode (1.4, PR #91) must not change Calm. The store now plans with
// nagModeStrategy instead of taskAwareStrategy; this is the regression guard:
//
// 1. Whenever nag mode doesn't apply (Calm, or a saved Nag without Plus,
//    without permission or with reminders off), nagModeStrategy returns
//    byte for byte what taskAwareStrategy returns, whatever the nag settings
//    and whatever day record is saved, and reads no network.
// 2. taskAwareStrategy itself returns what it did on main before this PR:
//    the plans for 600 fixed inputs are hashed, and CALM_DIGEST is that hash
//    computed with main's lib/ (origin/main at ef29de7, after the reminder polish PR and before this one). A deliberate change to the calm reminders has to change it here.
import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addDays, toDateKey } from "../lib/daily-tasks/date";
import { NAG_LEVELS, NAG_PERSONAS } from "../lib/daily-tasks/nag";
import { nagModeStrategy } from "../lib/daily-tasks/nag-day";
import { NAG_STORAGE_KEY, nagOpenTasks, planNagDay } from "../lib/daily-tasks/nag-plan";
import { taskAwareStrategy, type ReminderContext, type ReminderPlan } from "../lib/daily-tasks/reminder-plan";
import { DEFAULT_NOTIFICATIONS, type NotificationConfig, type NotificationPermissionState } from "../lib/daily-tasks/types";

// In-memory AsyncStorage (hoisted above the imports by vitest).
const store = vi.hoisted(() => {
  const values = new Map<string, string>();
  return {
    values,
    getItem: vi.fn(async (key: string) => values.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      values.delete(key);
    }),
    multiRemove: vi.fn(async (keys: string[]) => {
      keys.forEach((key) => values.delete(key));
    }),
  };
});
vi.mock("@react-native-async-storage/async-storage", () => ({ default: store }));
// The analytics client pulls in React Native, which Vitest can't load; the strategies never call it.
vi.mock("../lib/daily-tasks/analytics", () => ({ track: vi.fn() }));

/** sha256 of the calm plans for the fixed inputs below, computed with main's code. */
const CALM_DIGEST = "56180f9d63a6ae5a876c0eef17a73fd7c408c4468f0cc0331a1451f94fff5722";
/** The same with two weeks of mornings and the day-7 line (1.5 D). */
const CALM_DIGEST_15D = "2c0acdab2a52ce75f0dbea2d445db4b5e408046c20f31324a6eb133aa86e674c";

/** mulberry32. */
function seeded(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    bool: (chance = 0.5) => next() < chance,
    pick: <T,>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
  };
}
type Random = ReturnType<typeof seeded>;

const TEXTS = ["Call the dentist", "Write the quarterly report", "Walk the dog", "Renew the passport", "Email Sam about Friday", "Stretch for ten minutes", "Pay the water bill"];
const PERMISSIONS: readonly NotificationPermissionState[] = ["granted", "granted", "granted", "denied", "undetermined", "unsupported"];

/** The calm half of a context: everything the reminders were planned from before Nag mode existed. */
function calmContext(random: Random): ReminderContext {
  // 12 to 25 October 2026 (no clock change in the zones CI runs in).
  const now = new Date(2026, 9, 12 + random.int(0, 13), random.int(0, 23), random.int(0, 59));
  const clockDay = toDateKey(now);
  const today = addDays(clockDay, random.pick([0, 0, 0, 0, 0, -1, 1]));
  // A Fisher-Yates shuffle: a random comparator in sort() draws a different number of times on each engine.
  const texts = [...TEXTS];
  for (let i = texts.length - 1; i > 0; i--) {
    const j = random.int(0, i);
    [texts[i], texts[j]] = [texts[j], texts[i]];
  }
  const tasks = Array.from({ length: random.int(0, 3) }, (_unused, index) => ({ id: `t${index}`, text: texts[index], done: random.bool(0.35) }));
  const settings: NotificationConfig = {
    ...DEFAULT_NOTIFICATIONS,
    enabled: random.bool(0.9),
    morning: random.bool(0.85),
    progress: random.bool(0.85),
    evening: random.bool(0.85),
    hourly: random.bool(0.2),
    hideTaskNames: random.bool(0.25),
  };
  const draft = random.bool(0.25)
    ? { forDate: addDays(clockDay, random.pick([0, 1])), tasks: [texts[4], texts[5]].slice(0, random.int(1, 2)), note: "A note.", because: "Because.", source: "local" as const }
    : null;
  return {
    now,
    today,
    settings,
    permissionState: random.pick(PERMISSIONS),
    tasks,
    locked: random.bool(0.4),
    yesterdayOpen: random.bool(0.3) ? [texts[6]] : [],
    draft,
    pending: [],
    lastDeliveredAt: random.bool(0.3) ? new Date(now.getTime() - random.int(1, 180) * 60_000) : null,
  };
}

/** A plan as text that is the same in every time zone: times by the local clock, not as UTC. */
function stable(plan: ReminderPlan): string {
  const local = (date: Date) => {
    const two = (value: number) => String(value).padStart(2, "0");
    return `${toDateKey(date)}T${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
  };
  return JSON.stringify(plan.map((item) => ({ ...item, fireAt: local(item.fireAt) })));
}

const INPUTS = 600;
const contexts = (): ReminderContext[] => {
  const random = seeded(20261012);
  return Array.from({ length: INPUTS }, () => calmContext(random));
};

const realFetch = globalThis.fetch;
const networkFetch = vi.fn(async () => {
  throw new Error("network used");
});
beforeEach(() => {
  store.values.clear();
  vi.clearAllMocks();
  globalThis.fetch = networkFetch as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("Calm is unchanged by Nag mode", () => {
  it("the calm reminders for 600 fixed inputs are what main planned (digest)", () => {
    const all = contexts();
    const text = all.map((context) => stable(taskAwareStrategy(context))).join("\n");
    // The inputs really produce reminders, of every kind.
    expect(text).toMatch(/"kind":"morning"/);
    expect(text).toMatch(/"kind":"progress"/);
    expect(text).toMatch(/"kind":"evening"/);
    expect(all.filter((context) => taskAwareStrategy(context).length > 0).length).toBeGreaterThan(200);
    // 1.5 D adds a second week of mornings: up to six days ahead, the plans are main's, byte for byte.
    const firstWeek = all
      .map((context) => {
        const lastDay = new Date(context.now.getFullYear(), context.now.getMonth(), context.now.getDate() + 7);
        return stable(taskAwareStrategy(context).filter((item) => item.fireAt.getTime() < lastDay.getTime()));
      })
      .join("\n");
    expect(createHash("sha256").update(firstWeek).digest("hex")).toBe(CALM_DIGEST);
    // And the whole plan, mornings 7 to 14 included, as 1.5 D plans it.
    expect(createHash("sha256").update(text).digest("hex")).toBe(CALM_DIGEST_15D);
  });

  it("nagModeStrategy is taskAwareStrategy, byte for byte, whenever nag mode doesn't apply: Calm, no Plus, no permission, reminders off", async () => {
    const random = seeded(5);
    const all = contexts();
    let compared = 0;
    let withRecord = 0;
    for (const calm of all) {
      const expected = taskAwareStrategy(calm);
      const nagFields = (): Partial<NotificationConfig> => ({
        nagConfirmed: random.bool(),
        nagPersona: random.pick(NAG_PERSONAS),
        nagLevel: random.pick(NAG_LEVELS),
        nagWindow: random.pick([{ startMinutes: 540, endMinutes: 1260 }, { startMinutes: 0, endMinutes: 1439 }, { startMinutes: 600, endMinutes: 780 }]),
        nagPausedDate: random.pick([null, calm.today, addDays(calm.today, -1)]),
      });
      // A day record is saved (from when Nag was on), with nags still to come.
      const open = nagOpenTasks(calm.tasks);
      if (open.length > 0 && random.bool(0.7)) {
        const record = planNagDay({ previous: null, now: calm.now, dayKey: calm.today, settings: { ...DEFAULT_NOTIFICATIONS, nagLevel: "relentless", nagWindow: { startMinutes: 0, endMinutes: 1439 } }, open, salt: "s" });
        store.values.set(NAG_STORAGE_KEY, JSON.stringify(record));
        withRecord += 1;
      } else {
        store.values.delete(NAG_STORAGE_KEY);
      }
      const variants: ReminderContext[] = [
        // Calm, with or without Plus, whatever the nag settings say.
        { ...calm, settings: { ...calm.settings, ...nagFields(), style: "calm" }, plus: true },
        { ...calm, settings: { ...calm.settings, ...nagFields(), style: "calm" }, plus: false },
        { ...calm, settings: { ...calm.settings, ...nagFields(), style: "calm" } },
        // A saved Nag without Plus.
        { ...calm, settings: { ...calm.settings, ...nagFields(), style: "nag" }, plus: false },
        { ...calm, settings: { ...calm.settings, ...nagFields(), style: "nag" } },
      ];
      // A saved Nag with Plus, but no permission or reminders off.
      if (calm.permissionState !== "granted" || !calm.settings.enabled) {
        variants.push({ ...calm, settings: { ...calm.settings, ...nagFields(), style: "nag" }, plus: true });
      }
      for (const variant of variants) {
        const got = await nagModeStrategy(variant);
        expect(got).toEqual(expected);
        expect(JSON.stringify(got)).toBe(JSON.stringify(expected));
        expect(got.some((item) => item.kind === "nag" || item.categoryId !== undefined || item.interruptionLevel === "timeSensitive")).toBe(false);
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThanOrEqual(INPUTS * 5);
    expect(withRecord).toBeGreaterThan(100);
    expect(networkFetch).not.toHaveBeenCalled();
    // Calm never even writes the day record.
    expect(store.setItem).not.toHaveBeenCalled();
  });

  it("with Nag on the mornings are the calm mornings, byte for byte, and nothing else of the calm plan is left", async () => {
    const random = seeded(8);
    let nagDays = 0;
    for (const calm of contexts()) {
      if (calm.permissionState !== "granted" || !calm.settings.enabled || calm.today !== toDateKey(calm.now)) continue;
      const open = nagOpenTasks(calm.tasks);
      if (open.length === 0) continue;
      const settings: NotificationConfig = { ...calm.settings, style: "nag", nagConfirmed: true, nagLevel: random.pick(NAG_LEVELS), nagWindow: { startMinutes: 0, endMinutes: 1439 } };
      const record = planNagDay({ previous: null, now: calm.now, dayKey: calm.today, settings, open, salt: "s" });
      store.values.set(NAG_STORAGE_KEY, JSON.stringify(record));
      const got = await nagModeStrategy({ ...calm, settings, plus: true });
      const mornings = taskAwareStrategy(calm).filter((item) => item.kind === "morning");
      expect(JSON.stringify(got.filter((item) => item.kind !== "nag"))).toBe(JSON.stringify(mornings));
      for (const item of got) {
        expect(["timeSensitive", "critical"]).not.toContain(item.interruptionLevel);
        if (item.kind === "nag") expect(item.interruptionLevel).toBe("active");
      }
      // Paused today: the mornings alone.
      const paused = await nagModeStrategy({ ...calm, settings: { ...settings, nagPausedDate: calm.today }, plus: true });
      expect(JSON.stringify(paused)).toBe(JSON.stringify(mornings));
      nagDays += 1;
    }
    expect(nagDays).toBeGreaterThan(100);
    expect(networkFetch).not.toHaveBeenCalled();
  });
});
