// The reminder scheduler against a pretend notification centre (1.4, PR #89).
// The centre keeps what is pending and what was delivered the way the system
// does, so a test can look at what is there at every step and at the end,
// not only at which calls were made: nothing over iOS's 64 at any moment,
// nothing that isn't ours ever touched, no write when nothing changed, no
// task text left anywhere once names are hidden.
import * as Notifications from "expo-notifications";

import type { ReminderPlan, ReminderPlanItem } from "@/lib/daily-tasks/reminder-plan";
import { TRIAL_REMINDER_ID } from "@/lib/daily-tasks/trial-reminder";
import { DEFAULT_NOTIFICATIONS } from "@/lib/daily-tasks/types";

jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true })),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  getPresentedNotificationsAsync: jest.fn(async () => []),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  cancelAllScheduledNotificationsAsync: jest.fn(async () => {}),
  dismissNotificationAsync: jest.fn(async () => {}),
  dismissAllNotificationsAsync: jest.fn(async () => {}),
  scheduleNotificationAsync: jest.fn(async () => "id"),
  setNotificationHandler: jest.fn(),
  setNotificationCategoryAsync: jest.fn(async () => null),
  SchedulableTriggerInputTypes: { DAILY: "daily", DATE: "date", TIME_INTERVAL: "timeInterval" },
}));

const mocked = Notifications as jest.Mocked<typeof Notifications> & {
  cancelAllScheduledNotificationsAsync: jest.Mock;
  dismissAllNotificationsAsync: jest.Mock;
};

type NotificationsModule = typeof import("@/lib/daily-tasks/notifications");
let appState: { currentState: unknown };
/** A fresh module each time: the sync queue and what it remembers are module state (as after a cold start). */
function load(state: unknown = "background"): NotificationsModule {
  let mod: NotificationsModule | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- a fresh copy per test
    appState = require("react-native").AppState;
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- a fresh copy per test
    mod = require("@/lib/daily-tasks/notifications");
  });
  appState.currentState = state;
  return mod!;
}

// Monday 12 October 2026, 09:05 local.
const NOW = new Date(2026, 9, 12, 9, 5);
const FOCUS_ID = "three-today:focus-timer";
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

interface Content {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}
interface Stored {
  identifier: string;
  content: Content;
  at: Date;
}

/** The pretend centre. */
const centre = {
  platform: "ios" as "ios" | "android",
  pending: new Map<string, Stored>(),
  presented: [] as { date: number; request: { identifier: unknown; content: Content } }[],
  /** The most that were pending at once. */
  peak: 0,
  /** The fewest of ours pending at any moment after the first write. */
  fewestOwned: Infinity,
  rejectSchedule: new Set<string>(),
  rejectCancel: new Set<string>(),
  rejectDismiss: new Set<string>(),
  reset() {
    this.platform = "ios";
    this.pending.clear();
    this.presented = [];
    this.peak = 0;
    this.fewestOwned = Infinity;
    this.rejectSchedule.clear();
    this.rejectCancel.clear();
    this.rejectDismiss.clear();
  },
  seed(id: string, content: Content = { title: "old", body: "old" }, at: Date = minutes(600)) {
    this.pending.set(id, { identifier: id, content, at });
    this.peak = Math.max(this.peak, this.pending.size);
  },
  deliver(id: string, date = NOW.getTime() / 1000 - 60, content: Content = { title: "", body: "" }) {
    this.presented.push({ date, request: { identifier: id, content } });
  },
  note() {
    this.peak = Math.max(this.peak, this.pending.size);
    this.fewestOwned = Math.min(this.fewestOwned, this.owned().length);
  },
  owned(): Stored[] {
    return [...this.pending.values()].filter((item) => item.identifier.startsWith("daily-tasks:"));
  },
  others(): Stored[] {
    return [...this.pending.values()].filter((item) => !item.identifier.startsWith("daily-tasks:"));
  },
  /**
   * As the system hands them back: iOS as a time interval (the seconds are
   * from when it was scheduled, so they don't tell when), Android as a timestamp.
   */
  report(): object[] {
    return [...this.pending.values()].map(({ identifier, content, at }) =>
      this.platform === "ios"
        ? {
            identifier,
            content: { ...content, subtitle: null, sound: null },
            trigger: { type: "timeInterval", seconds: Math.max(1, Math.round((at.getTime() - NOW.getTime()) / 1000)), repeats: false },
          }
        : { identifier, content, trigger: { type: "date", value: at.getTime() } },
    );
  },
  /** Every word the centre holds, pending or delivered. */
  words(): string {
    return JSON.stringify([[...this.pending.values()].map((item) => item.content), this.presented.map((item) => item.request.content)]);
  },
};

const scheduledIds = () => mocked.scheduleNotificationAsync.mock.calls.map(([request]) => (request as { identifier: string }).identifier);
const cancelledIds = () => mocked.cancelScheduledNotificationAsync.mock.calls.map(([id]) => id);
const dismissedIds = () => mocked.dismissNotificationAsync.mock.calls.map(([id]) => id);
const writes = () => scheduledIds().length + cancelledIds().length + dismissedIds().length;
const clearCalls = () => {
  mocked.scheduleNotificationAsync.mockClear();
  mocked.cancelScheduledNotificationAsync.mockClear();
  mocked.dismissNotificationAsync.mockClear();
};

const TASKS = [
  { id: "t0", text: "Call the dentist", done: false },
  { id: "t1", text: "Write the report", done: false },
  { id: "t2", text: "Walk the dog", done: false },
];
const TASK_WORDS = /dentist|report|Walk|dog/i;
type Input = Parameters<NotificationsModule["syncNotifications"]>[0];
const input = (overrides: Partial<Input> = {}): Input => ({
  now: NOW,
  today: "2026-10-12",
  settings: DEFAULT_NOTIFICATIONS,
  permissionState: "granted" as const,
  tasks: TASKS,
  locked: false,
  yesterdayOpen: [],
  ...overrides,
});
const hidden = { ...DEFAULT_NOTIFICATIONS, hideTaskNames: true };

/** `count` owned reminders a minute apart, soonest first. */
const bigPlan = (count: number, tag = "new"): ReminderPlan =>
  Array.from({ length: count }, (_unused, i) => ({
    id: `daily-tasks:${tag}:${String(i).padStart(3, "0")}`,
    fireAt: minutes(i + 1),
    title: "A small nudge",
    body: `Body ${i}`,
  }));

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
  return { next, int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)), bool: (chance = 0.5) => next() < chance };
}

let warn: jest.SpyInstance;
let log: jest.SpyInstance;
let error: jest.SpyInstance;
let fetchSpy: jest.Mock;
const realFetch = globalThis.fetch;

beforeEach(() => {
  jest.clearAllMocks();
  centre.reset();
  mocked.getAllScheduledNotificationsAsync.mockImplementation(async () => centre.report() as never);
  mocked.getPresentedNotificationsAsync.mockImplementation(async () => [...centre.presented] as never);
  mocked.scheduleNotificationAsync.mockImplementation(async (request) => {
    const { identifier, content, trigger } = request as unknown as { identifier: string; content: Content; trigger: { date: Date } };
    if (centre.rejectSchedule.has(identifier)) throw new Error(`cannot schedule: ${content.title} ${content.body}`);
    centre.pending.set(identifier, { identifier, content, at: trigger.date });
    centre.note();
    return identifier;
  });
  mocked.cancelScheduledNotificationAsync.mockImplementation(async (id) => {
    if (centre.rejectCancel.has(id)) throw new Error("cannot cancel");
    centre.pending.delete(id);
    centre.note();
  });
  mocked.dismissNotificationAsync.mockImplementation(async (id) => {
    if (centre.rejectDismiss.has(id)) throw new Error("cannot dismiss");
    centre.presented = centre.presented.filter((item) => item.request.identifier !== id);
  });
  warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  log = jest.spyOn(console, "log").mockImplementation(() => {});
  error = jest.spyOn(console, "error").mockImplementation(() => {});
  fetchSpy = jest.fn(async () => {
    throw new Error("network used");
  });
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
});

afterEach(() => {
  warn.mockRestore();
  log.mockRestore();
  error.mockRestore();
  globalThis.fetch = realFetch;
});

describe("a sync that changes nothing writes nothing", () => {
  it.each(["ios", "android"] as const)("on %s: the same day again schedules, cancels and dismisses nothing", async (platform) => {
    centre.platform = platform;
    const { syncNotifications } = load();
    await syncNotifications(input());
    // 10 today (10, 12, 14, 16, 17..22) and 6 mornings.
    expect(scheduledIds()).toHaveLength(16);
    expect(centre.owned()).toHaveLength(16);
    const before = centre.words();

    clearCalls();
    await syncNotifications(input());
    // A minute later, and from a state that is equal but not the same objects.
    await syncNotifications(input({ now: minutes(1), tasks: TASKS.map((task) => ({ ...task })), settings: { ...DEFAULT_NOTIFICATIONS } }));
    expect(writes()).toBe(0);
    expect(centre.words()).toBe(before);
    // It did look, both times.
    expect(mocked.getAllScheduledNotificationsAsync.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("after a cold start (nothing remembered) what is pending from the last run is still recognised: no writes", async () => {
    await load().syncNotifications(input());
    clearCalls();
    // The app was killed and opened again: a fresh module, the same day.
    await load().syncNotifications(input({ now: minutes(3) }));
    expect(writes()).toBe(0);
  });

  it("ticking one task rewrites today's and tomorrow's, and leaves the mornings after as they are", async () => {
    const { syncNotifications } = load();
    await syncNotifications(input());
    clearCalls();

    await syncNotifications(input({ tasks: [{ ...TASKS[0], done: true }, TASKS[1], TASKS[2]] }));
    const rewritten = scheduledIds();
    expect(rewritten.length).toBeGreaterThan(0);
    expect(cancelledIds()).toEqual([]);
    // Only the 12th's, and the 13th's morning (written from what is open on the 12th).
    for (const id of rewritten) expect(id).toMatch(/^daily-tasks:2026-10-(12:|13:morning:)/);
    expect(rewritten.filter((id) => /2026-10-1[4-8]/.test(id))).toEqual([]);
    // The next one now has the count.
    expect(`${centre.pending.get("daily-tasks:2026-10-12:progress:1000")!.content.title} | ${centre.pending.get("daily-tasks:2026-10-12:progress:1000")!.content.body}`).toMatch(
      /1 of 3 done|1 done, 2 to go/,
    );
    // The same again: nothing.
    clearCalls();
    await syncNotifications(input({ tasks: [{ ...TASKS[0], done: true }, TASKS[1], TASKS[2]] }));
    expect(writes()).toBe(0);
  });

  it("once the next reminder has gone off, only what its going changes is rewritten: the new next one, not the mornings", async () => {
    const { syncNotifications } = load();
    await syncNotifications(input());
    clearCalls();
    // 10:00 was delivered: the system no longer has it pending.
    centre.pending.delete("daily-tasks:2026-10-12:progress:1000");

    await syncNotifications(input({ now: new Date(2026, 9, 12, 10, 1) }));
    expect(cancelledIds()).toEqual([]);
    expect(scheduledIds()).toContain("daily-tasks:2026-10-12:progress:1200");
    expect(scheduledIds().every((id) => id.startsWith("daily-tasks:2026-10-12:"))).toBe(true);
    expect(scheduledIds()).not.toContain("daily-tasks:2026-10-12:progress:1000");
    expect(centre.owned()).toHaveLength(15);
  });

  it("a pending reminder a second or more off, or with other words, is rewritten; one whose time can't be read too", async () => {
    const { applyReminderPlan } = load();
    const item = (id: string): ReminderPlanItem => ({ id: `daily-tasks:${id}`, fireAt: minutes(30), title: "A small nudge", body: "Body" });
    const same = { title: "A small nudge", body: "Body" };
    centre.seed("daily-tasks:same", same, minutes(30));
    centre.seed("daily-tasks:close", same, new Date(minutes(30).getTime() + 999));
    centre.seed("daily-tasks:off", same, new Date(minutes(30).getTime() + 1000));
    centre.seed("daily-tasks:title", { ...same, title: "A calm start" }, minutes(30));
    centre.seed("daily-tasks:body", { ...same, body: "Body." }, minutes(30));
    centre.platform = "android";
    await applyReminderPlan(["same", "close", "off", "title", "body"].map(item), NOW);
    expect(scheduledIds().sort()).toEqual(["daily-tasks:body", "daily-tasks:off", "daily-tasks:title"]);
    expect(cancelledIds()).toEqual([]);
  });
});

describe("on iOS a pending reminder's time is read from its own data", () => {
  // expo-notifications hands a one-off back as { type: "timeInterval", seconds,
  // repeats }: the seconds are from when it was scheduled, so they don't say when.
  const item = (id: string, at: Date): ReminderPlanItem => ({ id: `daily-tasks:${id}`, fireAt: at, title: "A small nudge", body: "Body" });
  const same = { title: "A small nudge", body: "Body" };

  it("every reminder is handed to the system with its own time, in ms, beside its kind and task id", async () => {
    await load().syncNotifications(input());
    expect(centre.owned()).toHaveLength(16);
    for (const stored of centre.owned()) {
      expect(stored.content.data?.fireAt).toBe(stored.at.getTime());
      expect(typeof stored.content.data?.kind).toBe("string");
    }
    // Nothing of the task but its id.
    expect(JSON.stringify(centre.owned().map((stored) => stored.content.data))).not.toMatch(TASK_WORDS);
  });

  it("the time in the data decides: the same is left, a second or more off is rewritten", async () => {
    const { applyReminderPlan } = load();
    const at = minutes(30);
    centre.seed("daily-tasks:same", { ...same, data: { fireAt: at.getTime() } }, at);
    centre.seed("daily-tasks:close", { ...same, data: { fireAt: at.getTime() + 999 } }, at);
    centre.seed("daily-tasks:off", { ...same, data: { fireAt: at.getTime() + 1000 } }, at);
    centre.seed("daily-tasks:early", { ...same, data: { fireAt: at.getTime() - 60_000 } }, at);
    await applyReminderPlan(["same", "close", "off", "early"].map((id) => item(id, at)), NOW);
    expect(scheduledIds().sort()).toEqual(["daily-tasks:early", "daily-tasks:off"]);
    expect(cancelledIds()).toEqual([]);
  });

  it("one pending from an earlier build (no time in its data) is rewritten once, and recognised from then on", async () => {
    const { applyReminderPlan } = load();
    const at = minutes(30);
    centre.seed("daily-tasks:bare", same, at);
    centre.seed("daily-tasks:kind-only", { ...same, data: { kind: "progress", taskId: "t1" } }, at);
    for (const [id, fireAt] of [["text", "soon"], ["nan", Number.NaN], ["zero", 0], ["none", null]] as const) {
      centre.seed(`daily-tasks:${id}`, { ...same, data: { fireAt } }, at);
    }
    const plan = ["bare", "kind-only", "text", "nan", "zero", "none"].map((id) => item(id, at));
    await applyReminderPlan(plan, NOW);
    expect(scheduledIds().sort()).toEqual(plan.map((entry) => entry.id).sort());
    for (const stored of centre.owned()) expect(stored.content.data?.fireAt).toBe(at.getTime());

    clearCalls();
    await applyReminderPlan(plan, minutes(1));
    await load().applyReminderPlan(plan, minutes(2));
    expect(writes()).toBe(0);
  });

  it("a strategy's own data can't take the time's place", async () => {
    const { applyReminderPlan } = load();
    const at = minutes(30);
    const plan: ReminderPlan = [{ ...item("own", at), data: { fireAt: 1, taskId: "t1" }, kind: "nag" }];
    await applyReminderPlan(plan, NOW);
    expect(centre.pending.get("daily-tasks:own")!.content.data).toEqual({ taskId: "t1", kind: "nag", fireAt: at.getTime() });
    clearCalls();
    await applyReminderPlan(plan, minutes(1));
    expect(writes()).toBe(0);
  });
});

describe("never more than 64 pending, at any moment", () => {
  it.each([
    [63, 1],
    [62, 2],
    [40, 24],
    [64, 0],
    [0, 62],
    [1, 62],
    [2, 62],
    [3, 61],
  ])("%i others pending: %i of ours fit, the soonest, and the others are as they were", async (others, room) => {
    const { applyReminderPlan } = load();
    centre.seed(FOCUS_ID);
    if (others > 1) centre.seed(TRIAL_REMINDER_ID);
    for (let i = centre.pending.size; i < others; i++) centre.seed(`someone-else:${i}`);
    if (others === 0) centre.pending.clear();
    // Old reminders of ours fill it to the brim.
    for (let i = 0; centre.pending.size < 64; i++) centre.seed(`daily-tasks:old:${i}`);
    const othersBefore = JSON.stringify(centre.others());
    centre.peak = centre.pending.size;

    await applyReminderPlan(bigPlan(80).reverse(), NOW);

    expect(centre.peak).toBeLessThanOrEqual(64);
    expect(centre.pending.size).toBeLessThanOrEqual(64);
    expect(centre.owned().map((item) => item.identifier).sort()).toEqual(bigPlan(room).map((item) => item.id));
    expect(JSON.stringify(centre.others())).toBe(othersBefore);
    expect(centre.others()).toHaveLength(others);
    expect(mocked.cancelAllScheduledNotificationsAsync).not.toHaveBeenCalled();
  });

  it.each([63, 62, 40])("the standard day beside %i others: within 64 throughout, soonest kept, and the same again writes nothing", async (others) => {
    const { syncNotifications } = load();
    for (let i = 0; i < others; i++) centre.seed(i === 0 ? FOCUS_ID : i === 1 ? TRIAL_REMINDER_ID : `someone-else:${i}`);
    await syncNotifications(input());

    const room = Math.min(16, 64 - others);
    expect(centre.peak).toBeLessThanOrEqual(64);
    expect(centre.owned()).toHaveLength(room);
    expect(centre.others()).toHaveLength(others);
    // The soonest: today's first.
    expect(centre.pending.has("daily-tasks:2026-10-12:progress:1000")).toBe(true);
    if (room < 16) expect(centre.pending.has("daily-tasks:2026-10-18:morning:1000")).toBe(false);

    clearCalls();
    await syncNotifications(input());
    expect(writes()).toBe(0);
  });

  it("with room for old and new together, the new are written before the old go: never a moment with none of ours pending", async () => {
    const { applyReminderPlan } = load();
    centre.seed(FOCUS_ID);
    for (let i = 0; i < 10; i++) centre.seed(`daily-tasks:old:${i}`);
    await applyReminderPlan(bigPlan(10), NOW);
    expect(centre.fewestOwned).toBeGreaterThanOrEqual(10);
    expect(centre.peak).toBe(21);
    expect(centre.owned().map((item) => item.identifier).sort()).toEqual(bigPlan(10).map((item) => item.id));
    const firstCancel = Math.min(...mocked.cancelScheduledNotificationAsync.mock.invocationCallOrder);
    const lastSchedule = Math.max(...mocked.scheduleNotificationAsync.mock.invocationCallOrder);
    expect(lastSchedule).toBeLessThan(firstCancel);
  });

  it("an empty plan clears ours and nothing else, on any path: reminders off, permission gone, the web's no-op aside", async () => {
    for (const overrides of [
      { settings: { ...DEFAULT_NOTIFICATIONS, enabled: false } },
      { permissionState: "denied" as const },
      { permissionState: "undetermined" as const },
      { strategy: () => [] },
    ]) {
      centre.reset();
      centre.seed(FOCUS_ID);
      centre.seed(TRIAL_REMINDER_ID);
      for (let i = 0; i < 5; i++) centre.seed(`daily-tasks:old:${i}`);
      await load().syncNotifications(input(overrides));
      expect([...centre.pending.keys()].sort()).toEqual([TRIAL_REMINDER_ID, FOCUS_ID].sort());
    }
  });
});

describe("what isn't ours is never touched, whatever the plan and whatever is pending", () => {
  const FOREIGN = [FOCUS_ID, TRIAL_REMINDER_ID, "daily-tasks", "daily-task:typo", "x-daily-tasks:2026-10-12:progress:1000", "Daily-Tasks:caps", "", "com.apple.something"];

  it("over generated plans and centres: every other notification is left exactly as it was, pending and delivered", async () => {
    const random = seeded(89_601);
    for (let run = 0; run < 60; run++) {
      centre.reset();
      clearCalls();
      const mod = load(random.bool() ? "active" : "background");
      const foreign = FOREIGN.filter(() => random.bool(0.7));
      foreign.forEach((id) => centre.seed(id, { title: `keep ${id}`, body: "keep" }, minutes(random.int(1, 900))));
      const oldCount = random.int(0, 30);
      for (let i = 0; i < oldCount; i++) centre.seed(`daily-tasks:x:${i}`, { title: "old", body: "old" }, minutes(random.int(1, 900)));
      FOREIGN.filter(() => random.bool()).forEach((id) => centre.deliver(id));
      centre.deliver("daily-tasks:x:went-off");
      const othersBefore = JSON.stringify(centre.others());
      const deliveredOthersBefore = centre.presented.filter((item) => !String(item.request.identifier).startsWith("daily-tasks:"));

      const plan: ReminderPlan = Array.from({ length: random.int(0, 70) }, (_unused, i) => ({
        // Some keep an old id, some are new, some try an id that isn't ours.
        id: random.bool(0.15) ? FOREIGN[random.int(0, FOREIGN.length - 1)] : `daily-tasks:x:${random.int(0, 45)}`,
        fireAt: minutes(random.int(-30, 900)),
        title: `t${i}`,
        body: `b${i}`,
      }));
      if (random.bool()) await mod.applyReminderPlan(plan, NOW, { dismissDelivered: random.bool() });
      else await mod.syncNotifications(input({ strategy: () => plan, settings: random.bool() ? hidden : DEFAULT_NOTIFICATIONS }));

      // The run, should one fail.
      expect({ run, others: JSON.stringify(centre.others()) }).toEqual({ run, others: othersBefore });
      expect(centre.presented.filter((item) => !String(item.request.identifier).startsWith("daily-tasks:"))).toEqual(deliveredOthersBefore);
      for (const id of [...scheduledIds(), ...cancelledIds(), ...dismissedIds()]) expect(id.startsWith("daily-tasks:")).toBe(true);
      expect(centre.peak).toBeLessThanOrEqual(64);
      // What is left of ours is exactly the part of the plan that could be scheduled.
      const wanted = new Set(
        plan.filter((item) => item.id.startsWith("daily-tasks:") && item.fireAt.getTime() > NOW.getTime()).map((item) => item.id),
      );
      expect(new Set(centre.owned().map((item) => item.identifier))).toEqual(wanted);
    }
    expect(mocked.cancelAllScheduledNotificationsAsync).not.toHaveBeenCalled();
    expect(mocked.dismissAllNotificationsAsync).not.toHaveBeenCalled();
  });

  it("cancelAllNotifications removes ours and only ours", async () => {
    const { cancelAllNotifications } = load();
    FOREIGN.forEach((id) => centre.seed(id));
    for (let i = 0; i < 7; i++) centre.seed(`daily-tasks:x:${i}`);
    await cancelAllNotifications();
    expect([...centre.pending.keys()].sort()).toEqual([...FOREIGN].sort());
    expect(mocked.cancelAllScheduledNotificationsAsync).not.toHaveBeenCalled();
  });
});

describe("when the system refuses some of it", () => {
  it("over generated refusals: the sync still resolves, everything else is written and removed, and the log has ids only", async () => {
    const random = seeded(89_602);
    for (let run = 0; run < 40; run++) {
      centre.reset();
      clearCalls();
      warn.mockClear();
      const { applyReminderPlan } = load();
      centre.seed(FOCUS_ID);
      const stale = Array.from({ length: random.int(1, 12) }, (_unused, i) => `daily-tasks:old:${i}`);
      stale.forEach((id) => centre.seed(id, { title: "Call the dentist", body: "Still open?" }));
      const plan = bigPlan(random.int(1, 25)).map((item) => ({ ...item, title: "Walk the dog", body: "Write the report. Still open?" }));
      // Some of the new ones replace a pending one that says something else.
      const replaced = plan.filter(() => random.bool(0.3)).map((item) => item.id);
      replaced.forEach((id) => centre.seed(id, { title: "Call the dentist", body: "1 of 3 done." }));
      plan.filter(() => random.bool(0.4)).forEach((item) => centre.rejectSchedule.add(item.id));
      stale.filter(() => random.bool(0.4)).forEach((id) => centre.rejectCancel.add(id));

      await expect(applyReminderPlan(plan, NOW)).resolves.toBeUndefined();

      // Each one was tried, once (with the run, should one fail).
      expect({ run, ids: scheduledIds().sort() }).toEqual({ run, ids: plan.map((item) => item.id).sort() });
      for (const id of stale) expect(cancelledIds().filter((each) => each === id)).toHaveLength(1);
      // Written: every one the system took. Gone: every stale one it let go, and
      // every out-of-date one whose replacement it refused.
      const left = new Set(centre.owned().map((item) => item.identifier));
      expect(left).toEqual(
        new Set([...plan.filter((item) => !centre.rejectSchedule.has(item.id)).map((item) => item.id), ...stale.filter((id) => centre.rejectCancel.has(id))]),
      );
      for (const id of replaced) {
        if (centre.rejectSchedule.has(id)) expect(centre.pending.has(id)).toBe(false);
        else expect(centre.pending.get(id)!.content.title).toBe("Walk the dog");
      }
      expect(centre.pending.has(FOCUS_ID)).toBe(true);
      // One warning per refusal, and never a reminder's words in it (the error is the system's own).
      const refused = plan.filter((item) => centre.rejectSchedule.has(item.id)).length + stale.filter((id) => centre.rejectCancel.has(id)).length;
      expect(warn.mock.calls.length).toBe(refused);
      for (const [message] of warn.mock.calls) {
        expect(String(message)).toMatch(/^\[daily-tasks\] failed to (schedule|cancel) reminder daily-tasks:\S+$/);
        expect(String(message)).not.toMatch(TASK_WORDS);
      }
    }
  });

  it("a sync after a refused one puts right what was refused", async () => {
    const { syncNotifications } = load();
    centre.rejectSchedule.add("daily-tasks:2026-10-12:progress:1200");
    centre.rejectSchedule.add("daily-tasks:2026-10-13:morning:0800");
    await syncNotifications(input());
    expect(centre.owned()).toHaveLength(14);
    centre.rejectSchedule.clear();
    clearCalls();
    await syncNotifications(input());
    expect(scheduledIds().sort()).toEqual(["daily-tasks:2026-10-12:progress:1200", "daily-tasks:2026-10-13:morning:0800"]);
    expect(centre.owned()).toHaveLength(16);
  });

  it("the system failing to list what is pending fails that sync whole (nothing written blind), and the next one runs", async () => {
    const { syncNotifications } = load();
    mocked.getAllScheduledNotificationsAsync.mockRejectedValueOnce(new Error("unavailable"));
    await expect(syncNotifications(input())).rejects.toThrow("unavailable");
    expect(writes()).toBe(0);
    await syncNotifications(input());
    expect(centre.owned()).toHaveLength(16);
  });
});

describe("reminders that already went off", () => {
  const deliverSome = () => {
    centre.deliver("daily-tasks:2026-10-12:morning:0800", undefined, { title: "Call the dentist", body: "First up today." });
    centre.deliver("daily-tasks:2026-10-11:evening:2200", undefined, { title: "Still time today", body: "Walk the dog is still open." });
    centre.deliver(FOCUS_ID, undefined, { title: "Walk the dog", body: "Time's up." });
    centre.deliver(TRIAL_REMINDER_ID);
    centre.deliver("daily-tasks");
    centre.deliver("someone-else");
    centre.presented.push({ date: 1, request: { identifier: undefined, content: { title: "", body: "" } } });
    centre.presented.push({ date: 1, request: { identifier: 42, content: { title: "", body: "" } } });
  };
  const OURS = ["daily-tasks:2026-10-11:evening:2200", "daily-tasks:2026-10-12:morning:0800"];
  const leftBehind = () => centre.presented.map((item) => item.request.identifier);

  it.each([
    ["active", true],
    ["background", false],
    ["inactive", false],
    [undefined, false],
    ["unknown", false],
  ])("app state %s: cleared = %s, and only ever ours", async (state, cleared) => {
    const { syncNotifications } = load(state);
    deliverSome();
    await syncNotifications(input());
    expect(dismissedIds().sort()).toEqual(cleared ? OURS : []);
    expect(leftBehind()).toEqual(expect.arrayContaining([FOCUS_ID, TRIAL_REMINDER_ID, "daily-tasks", "someone-else", undefined, 42]));
    expect(leftBehind()).toHaveLength(cleared ? 6 : 8);
    expect(mocked.dismissAllNotificationsAsync).not.toHaveBeenCalled();
  });

  it("in the background they go only on the sync where Hide task names turns on: not before, not again after, not when it turns off", async () => {
    const { syncNotifications } = load("background");
    const sync = async (hide: boolean) => {
      clearCalls();
      centre.presented = [];
      deliverSome();
      await syncNotifications(input({ settings: hide ? hidden : DEFAULT_NOTIFICATIONS }));
      return dismissedIds().sort();
    };
    expect(await sync(false)).toEqual([]);
    expect(await sync(true)).toEqual(OURS);
    // Still on: nothing new to hide.
    expect(await sync(true)).toEqual([]);
    expect(await sync(false)).toEqual([]);
    expect(await sync(false)).toEqual([]);
    expect(await sync(true)).toEqual(OURS);
    // Once names are hidden, what is left in Notification Center of ours has no task in it.
    expect(JSON.stringify(centre.presented.filter((item) => String(item.request.identifier).startsWith("daily-tasks:")))).not.toMatch(TASK_WORDS);
  });

  it("the first sync after a cold start with the switch already on is not 'just turned on'", async () => {
    const { syncNotifications } = load("background");
    deliverSome();
    await syncNotifications(input({ settings: hidden }));
    expect(dismissedIds()).toEqual([]);
  });

  it("a sync that failed doesn't count as the last one: off, then a failed 'on', then 'on' still clears them", async () => {
    const { syncNotifications } = load("background");
    await syncNotifications(input());
    deliverSome();
    await expect(
      syncNotifications(
        input({
          settings: hidden,
          strategy: () => {
            throw new Error("no plan");
          },
        }),
      ),
    ).rejects.toThrow("no plan");
    expect(dismissedIds()).toEqual([]);
    await syncNotifications(input({ settings: hidden }));
    expect(dismissedIds().sort()).toEqual(OURS);
  });

  it("applyReminderPlan clears them only when asked, whatever the app's state", async () => {
    const { applyReminderPlan } = load("active");
    deliverSome();
    await applyReminderPlan(bigPlan(2), NOW);
    expect(dismissedIds()).toEqual([]);
    await applyReminderPlan(bigPlan(2), NOW, { dismissDelivered: false });
    expect(dismissedIds()).toEqual([]);
    await applyReminderPlan(bigPlan(2), NOW, { dismissDelivered: true });
    expect(dismissedIds().sort()).toEqual(OURS);
  });

  it("one that can't be dismissed doesn't stop the next, and they are cleared after the new plan is in place", async () => {
    const { syncNotifications } = load("active");
    deliverSome();
    centre.rejectDismiss.add(OURS[1]);
    await expect(syncNotifications(input())).resolves.toBeUndefined();
    expect(dismissedIds().sort()).toEqual(OURS);
    expect(leftBehind()).toContain(OURS[1]);
    expect(leftBehind()).not.toContain(OURS[0]);
    const firstDismiss = Math.min(...mocked.dismissNotificationAsync.mock.invocationCallOrder);
    expect(Math.max(...mocked.scheduleNotificationAsync.mock.invocationCallOrder)).toBeLessThan(firstDismiss);
  });
});

describe("Hide task names, end to end through the scheduler", () => {
  it.each(["ios", "android"] as const)("on %s: turning it on leaves no task text pending anywhere, and turning it off brings the names back", async (platform) => {
    centre.platform = platform;
    const { syncNotifications } = load("background");
    const draft = { forDate: "2026-10-14", tasks: ["Water the dog's plants"], note: "", because: "", source: "local" as const };
    await syncNotifications(input({ draft }));
    expect(centre.words()).toMatch(/dentist/);
    expect(centre.words()).toMatch(/plants/);
    // One went off with a name in it.
    centre.deliver("daily-tasks:2026-10-12:morning:0800", undefined, { title: "Call the dentist", body: "First up today." });

    clearCalls();
    await syncNotifications(input({ draft, settings: hidden }));
    expect(centre.words()).not.toMatch(TASK_WORDS);
    expect(centre.words()).not.toMatch(/plants/);
    expect(centre.owned()).toHaveLength(16);
    for (const item of centre.owned()) {
      expect(["A calm start", "A small nudge", "Still time today"]).toContain(item.content.title);
      // The kind and its own time ride along; no task id any more, since no task is named.
      expect(Object.keys(item.content.data ?? {})).toEqual(["kind", "fireAt"]);
    }
    // Same times as with names: hiding changes the words only.
    expect(cancelledIds()).toEqual([]);

    // Still hidden: nothing to write.
    clearCalls();
    await syncNotifications(input({ draft, settings: hidden }));
    expect(writes()).toBe(0);

    await syncNotifications(input({ draft }));
    expect(centre.words()).toMatch(/dentist/);
  });

  it("if the system refuses the hidden rewrite of some, the named ones they would have replaced are removed: none with a name survives", async () => {
    const { syncNotifications } = load("background");
    await syncNotifications(input());
    const named = centre.owned().filter((item) => TASK_WORDS.test(JSON.stringify(item.content)));
    expect(named.length).toBeGreaterThanOrEqual(10);
    named.filter((_item, index) => index % 2 === 0).forEach((item) => centre.rejectSchedule.add(item.identifier));

    await syncNotifications(input({ settings: hidden }));
    expect(centre.words()).not.toMatch(TASK_WORDS);
    for (const id of centre.rejectSchedule) expect(centre.pending.has(id)).toBe(false);
    // The log of those refusals has no task text either.
    expect(JSON.stringify(warn.mock.calls.map(([message]) => message))).not.toMatch(TASK_WORDS);
  });

  it("with names hidden from the start nothing with a task in it is ever handed to the system, whatever the day looks like", async () => {
    const { syncNotifications } = load("active");
    const days: Partial<Input>[] = [
      {},
      { tasks: [{ ...TASKS[0], done: true }, TASKS[1], TASKS[2]] },
      { tasks: [TASKS[2]] },
      { tasks: TASKS.map((task) => ({ ...task, done: true })) },
      { tasks: [], yesterdayOpen: ["Call the dentist", "Walk the dog"] },
      { tasks: [], draft: { forDate: "2026-10-12", tasks: ["Write the report"], note: "", because: "", source: "ai" } },
      { tasks: TASKS, draft: { forDate: "2026-10-13", tasks: ["Write the report"], note: "", because: "", source: "ai" } },
      { tasks: TASKS, today: "2026-10-11" },
      { tasks: TASKS, today: "2026-10-13" },
      { tasks: TASKS, settings: { ...hidden, hourly: true } },
      { tasks: TASKS, locked: true, now: new Date(2026, 9, 12, 18, 30) },
    ];
    for (const day of days) await syncNotifications(input({ settings: hidden, ...day }));
    expect(mocked.scheduleNotificationAsync.mock.calls.length).toBeGreaterThan(20);
    expect(JSON.stringify(mocked.scheduleNotificationAsync.mock.calls)).not.toMatch(TASK_WORDS);
    expect(centre.words()).not.toMatch(TASK_WORDS);
  });
});

describe("nothing leaves the device", () => {
  it("a day of syncs, with names shown and hidden, makes no network call and logs no task text", async () => {
    const { syncNotifications, applyReminderPlan, cancelAllNotifications } = load("active");
    centre.deliver("daily-tasks:2026-10-12:morning:0800", undefined, { title: "Call the dentist", body: "First up today." });
    await syncNotifications(input());
    await syncNotifications(input({ tasks: [{ ...TASKS[0], done: true }, TASKS[1], TASKS[2]], now: minutes(70) }));
    await syncNotifications(input({ settings: hidden, now: minutes(200) }));
    await syncNotifications(input({ tasks: [], yesterdayOpen: ["Walk the dog"], today: "2026-10-13", now: new Date(2026, 9, 13, 7, 0) }));
    await applyReminderPlan(bigPlan(3), NOW);
    await cancelAllNotifications();

    expect(fetchSpy).not.toHaveBeenCalled();
    // The task's words went to one place only: the local notification's title and body.
    for (const spy of [warn, log, error]) expect(JSON.stringify(spy.mock.calls)).not.toMatch(TASK_WORDS);
    for (const [request] of mocked.scheduleNotificationAsync.mock.calls) {
      const { content, trigger, identifier } = request as unknown as { content: Content; trigger: object; identifier: string };
      expect(`${identifier} ${JSON.stringify(trigger)} ${JSON.stringify(content.data ?? {})}`).not.toMatch(TASK_WORDS);
      // A local, one-off date trigger: no push, no remote content.
      expect(trigger).toMatchObject({ type: "date" });
      expect(Object.keys(content).sort()).toEqual(content.data ? ["body", "data", "title"] : ["body", "title"]);
    }
  });
});
