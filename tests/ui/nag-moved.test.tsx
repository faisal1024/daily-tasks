// Nag mode (1.5 C): how often each task was moved goes with the AI request
// (only for the moved ones). The weighting of the built-in lines is in
// tests/nag-moved-weights.test.ts.
import AsyncStorage from "@react-native-async-storage/async-storage";

import type { NagLine, requestNagLines } from "@/lib/daily-tasks/nag";
import { ensureNagDay, type NagDayInput } from "@/lib/daily-tasks/nag-day";
import { DEFAULT_NOTIFICATIONS, type NotificationConfig } from "@/lib/daily-tasks/types";

const DAY = "2026-10-12";
const at = (hour: number) => new Date(2026, 9, 12, hour);
const NAG_ON: NotificationConfig = { ...DEFAULT_NOTIFICATIONS, style: "nag", nagConfirmed: true };
const TASKS = [
  { id: "t0", text: "Call the dentist", done: false },
  { id: "t1", text: "Write the report", done: false },
  { id: "t2", text: "Walk the dog", done: false },
];
type Request = typeof requestNagLines;
let request: jest.MockedFunction<Request>;

const input = (overrides: Partial<NagDayInput> = {}): NagDayInput => ({
  now: at(8),
  today: DAY,
  settings: NAG_ON,
  permissionState: "granted",
  plus: true,
  aiAllowed: true,
  tasks: TASKS,
  ...overrides,
});

beforeEach(async () => {
  await AsyncStorage.clear();
  request = jest.fn(async ({ count }) => ({
    lines: Array.from({ length: count }, (_unused, index): NagLine => ({ step: index + 1, taskIndex: index % 3, text: `AI line ${index + 1}` })),
  })) as jest.MockedFunction<Request>;
  jest.useFakeTimers({ now: at(8), doNotFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "queueMicrotask", "nextTick"] });
});

afterEach(() => {
  jest.useRealTimers();
});

describe("the AI is told how often a task was moved", () => {
  it("a moved task carries its count; the others are sent exactly as before", async () => {
    await ensureNagDay(input({ moved: { t1: 3 } }), { request });
    expect(request.mock.calls[0][0].tasks).toEqual([
      { id: "t0", text: "Call the dentist" },
      { id: "t1", text: "Write the report", moved: 3 },
      { id: "t2", text: "Walk the dog" },
    ]);
  });

  it("with nothing moved (none, empty, zero) the request has no moved field anywhere", async () => {
    for (const moved of [undefined, {}, { t0: 0 }] as (Record<string, number> | undefined)[]) {
      await AsyncStorage.clear();
      request.mockClear();
      await ensureNagDay(input(moved ? { moved } : {}), { request });
      expect(request.mock.calls[0][0].tasks.some((task) => "moved" in task)).toBe(false);
    }
  });
});
