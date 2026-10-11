// Notification categories (PR #91 review, P1): expo-notifications sets a
// category by reading the registered set, awaiting, then writing the set plus
// its own. Two registrations in flight both read the old set, so the later
// write drops the other's categories: the focus timer loses its buttons or
// the nag loses "Stop for today". The mock below behaves that way; every
// category must still be there however the registrations are started.
import * as Notifications from "expo-notifications";

import { NAG_CATEGORY_ID } from "@/lib/daily-tasks/reminders";

type Action = { identifier: string; buttonTitle: string };
const registered = new Map<string, Action[]>();
let inFlight = 0;
let mostInFlight = 0;

jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true })),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  dismissNotificationAsync: jest.fn(async () => {}),
  scheduleNotificationAsync: jest.fn(async () => "id"),
  setNotificationHandler: jest.fn(),
  setNotificationCategoryAsync: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponse: jest.fn(() => null),
  clearLastNotificationResponse: jest.fn(),
  SchedulableTriggerInputTypes: { DAILY: "daily", DATE: "date", TIME_INTERVAL: "timeInterval" },
}));

const mocked = Notifications as jest.Mocked<typeof Notifications>;

/** As CategoryManager does it: read the set, await, write the set read plus this one. */
async function lossySet(id: string, actions: Action[]) {
  inFlight += 1;
  mostInFlight = Math.max(mostInFlight, inFlight);
  const snapshot = new Map(registered);
  await new Promise((resolve) => setTimeout(resolve, 5));
  snapshot.set(id, actions);
  registered.clear();
  snapshot.forEach((value, key) => registered.set(key, value));
  inFlight -= 1;
  return null;
}

type NotificationsModule = typeof import("@/lib/daily-tasks/notifications");
function load(): NotificationsModule {
  let mod: NotificationsModule | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- a fresh copy per test
    mod = require("@/lib/daily-tasks/notifications");
  });
  return mod!;
}

const titles = (id: string) => (registered.get(id) ?? []).map((action) => action.buttonTitle);

function expectAll(mod: NotificationsModule) {
  expect([...registered.keys()].sort()).toEqual([mod.FOCUS_CATEGORY_ID, mod.FOCUS_STARTER_CATEGORY_ID, NAG_CATEGORY_ID].sort());
  expect(titles(mod.FOCUS_CATEGORY_ID)).toEqual(["5 more minutes", "Take a break", "Mark done"]);
  expect(titles(mod.FOCUS_STARTER_CATEGORY_ID)).toEqual(["Keep going", "Stop for now", "Mark done"]);
  expect(titles(NAG_CATEGORY_ID)).toEqual(["Stop for today"]);
}

beforeEach(() => {
  jest.clearAllMocks();
  registered.clear();
  inFlight = 0;
  mostInFlight = 0;
  mocked.setNotificationCategoryAsync.mockImplementation(lossySet as never);
});

describe("notification categories are registered one at a time", () => {
  it("the mock really loses a category when two are set at once", async () => {
    await Promise.all([lossySet("a", []), lossySet("b", [])]);
    expect(registered.size).toBe(1);
  });

  it("registerNotificationCategories leaves the focus timer's buttons and the nag's", async () => {
    const mod = load();
    await mod.registerNotificationCategories();
    expectAll(mod);
    expect(mostInFlight).toBe(1);
  });

  it("the two registrations started together, as the store used to, no longer lose one", async () => {
    const mod = load();
    await Promise.all([mod.registerFocusCategory(), mod.registerNagCategory()]);
    expectAll(mod);
    expect(mostInFlight).toBe(1);
  });

  it("called several times at once, with a focus notification being scheduled meanwhile: still all of them, each set once", async () => {
    const mod = load();
    await Promise.all([
      mod.registerNotificationCategories(),
      mod.scheduleFocusSessionNotification({
        sessionId: "s1",
        taskId: "t0",
        kind: "timer",
        at: new Date(Date.now() + 60_000),
        title: "Walk",
        body: "Time's up. 5 more minutes, or mark it done?",
      }),
      mod.registerNotificationCategories(),
      mod.registerNagCategory(),
    ]);
    expectAll(mod);
    expect(mostInFlight).toBe(1);
    expect(mocked.setNotificationCategoryAsync).toHaveBeenCalledTimes(3);
  });

  it("never rejects, and a failed focus registration doesn't stop the nag's", async () => {
    const mod = load();
    mocked.setNotificationCategoryAsync.mockImplementation((async (id: string, actions: Action[]) => {
      if (id === mod.FOCUS_CATEGORY_ID) throw new Error("boom");
      return lossySet(id, actions);
    }) as never);
    await expect(mod.registerNotificationCategories()).resolves.toBeUndefined();
    expect(titles(NAG_CATEGORY_ID)).toEqual(["Stop for today"]);
    // The next launch (or the next schedule) tries the focus ones again.
    mocked.setNotificationCategoryAsync.mockImplementation(lossySet as never);
    await mod.registerNotificationCategories();
    expectAll(mod);
  });
});

describe("a native category call that never settles", () => {
  const session = { sessionId: "s1", taskId: "t0", kind: "timer" as const, title: "Walk", body: "Time's up. 5 more minutes, or mark it done?" };
  const never = () => new Promise<null>(() => {});

  afterEach(() => {
    jest.useRealTimers();
  });

  it("doesn't hold up the focus timer's end notification: after 4 seconds it is scheduled anyway", async () => {
    jest.useFakeTimers();
    const mod = load();
    expect(mod.CATEGORY_CALL_TIMEOUT_MS).toBe(4_000);
    mocked.setNotificationCategoryAsync.mockImplementation(never as never);
    let settled = false;
    const scheduled = mod.scheduleFocusSessionNotification({ ...session, at: new Date(Date.now() + 60_000) }).then(() => {
      settled = true;
    });
    await jest.advanceTimersByTimeAsync(mod.CATEGORY_CALL_TIMEOUT_MS - 1);
    expect(mocked.setNotificationCategoryAsync).toHaveBeenCalledTimes(1);
    expect(mocked.scheduleNotificationAsync).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await scheduled;
    expect(settled).toBe(true);
    expect(mocked.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(mocked.scheduleNotificationAsync.mock.calls[0][0]).toMatchObject({ identifier: mod.FOCUS_TIMER_NOTIFICATION_ID, content: { title: "Walk" } });
  });

  it("the launch registration hanging too: each call in the queue is given up on after its own 4 seconds, and nothing rejects", async () => {
    jest.useFakeTimers();
    const mod = load();
    mocked.setNotificationCategoryAsync.mockImplementation(never as never);
    const launch = mod.registerNotificationCategories();
    const scheduled = mod.scheduleFocusSessionNotification({ ...session, at: new Date(Date.now() + 60_000) });
    await jest.advanceTimersByTimeAsync(2 * mod.CATEGORY_CALL_TIMEOUT_MS);
    await expect(scheduled).resolves.toBeUndefined();
    expect(mocked.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(mod.CATEGORY_CALL_TIMEOUT_MS);
    await expect(launch).resolves.toBeUndefined();
  });

  it("a call that does settle is not cut short, and leaves no timer behind", async () => {
    jest.useFakeTimers();
    const mod = load();
    mocked.setNotificationCategoryAsync.mockImplementation((async (id: string, actions: Action[]) => {
      registered.set(id, actions);
      return null;
    }) as never);
    await mod.registerNotificationCategories();
    expectAll(mod);
    expect(jest.getTimerCount()).toBe(0);
  });
});
