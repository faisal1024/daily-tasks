// Nag mode (1.4, Plus, opt-in): the day's record and where its lines come
// from. Once a day (and at most once more, if the open tasks, the persona or
// the level change) the open tasks are sent to the AI proxy for a batch of
// lines; on any failure, offline, or with task names hidden, the built-in
// lines are used and nothing is sent. The record is kept in AsyncStorage
// under its own key; the reminder strategy below only reads it.
//
// Nothing here blocks the UI or throws. The rules for times and words are in
// nag-plan.ts.

import AsyncStorage from "@react-native-async-storage/async-storage";

import { track } from "./analytics";
import { toDateKey } from "./date";
import { requestNagLines } from "./nag";
import {
  applyAiNagLines,
  nagAiKey,
  nagDayNeedsPlan,
  nagDayWantsAi,
  nagModeOn,
  nagOpenTasks,
  nagPlanFromRecord,
  nagRecordApplies,
  NAG_STORAGE_KEY,
  normalizeNagRecord,
  planNagDay,
  type NagDayRecord,
} from "./nag-plan";
import { taskAwareStrategy, type ReminderContext, type ReminderPlan, type ReminderStrategy } from "./reminder-plan";

/** A nag request gives up sooner than the other AI calls: the built-in lines are already in place. */
export const NAG_REQUEST_TIMEOUT_MS = 20_000;

/** The saved record, or null (nothing saved, damaged, or storage failed). Never throws. */
export async function loadNagRecord(): Promise<NagDayRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(NAG_STORAGE_KEY);
    return raw ? normalizeNagRecord(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

async function saveNagRecord(record: NagDayRecord): Promise<boolean> {
  try {
    await AsyncStorage.setItem(NAG_STORAGE_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

function newSalt(): string {
  return Math.random().toString(36).slice(2, 12) || "salt";
}

export type NagDayInput = Pick<ReminderContext, "today" | "settings" | "permissionState" | "tasks"> & {
  now?: Date;
  /** Plus as the app shows it (true while the purchase check is still running). */
  plus: boolean;
  /** Plus is confirmed, so the proxy will answer: only then is the AI asked. */
  aiAllowed: boolean;
};

export interface NagDayDeps {
  request?: typeof requestNagLines;
  /** Called with the record's version each time it is saved with a change. */
  onChange?: (version: number) => void;
}

// One at a time: two overlapping runs could both ask the AI.
let queue: Promise<void> = Promise.resolve();

/**
 * Makes today's record what it should be, when nag mode applies and isn't
 * paused: plans the day with built-in lines (at once, saved, `onChange`),
 * then, if the AI should be asked, asks it and writes its lines into the
 * slots still to come (saved, `onChange` again). Call it at launch, on
 * coming to the front and when the tasks or the settings change; it does
 * nothing when nothing changed. Never throws.
 */
export function ensureNagDay(input: NagDayInput, deps: NagDayDeps = {}): Promise<void> {
  const run = queue.then(() => runNagDay(input, deps)).catch(() => {});
  queue = run;
  return run;
}

async function runNagDay(input: NagDayInput, { request = requestNagLines, onChange }: NagDayDeps): Promise<void> {
  const now = input.now ?? new Date();
  const { today, settings } = input;
  if (!nagModeOn(settings, input.plus, input.permissionState)) return;
  if (settings.nagPausedDate === today || today !== toDateKey(now)) return;
  const open = nagOpenTasks(input.tasks);
  if (open.length === 0) return;

  const previous = await loadNagRecord();
  let record = previous;
  let planned = false;
  if (!record || nagDayNeedsPlan(record, { dayKey: today, settings, open })) {
    record = planNagDay({ previous, now, dayKey: today, settings, open, salt: newSalt() });
    planned = true;
    if (!(await saveNagRecord(record))) return;
    onChange?.(record.version);
  }

  const asked = input.aiAllowed && nagDayWantsAi(record, open, now);
  if (asked) {
    // Counted before it is sent, so a crash mid-request can't lead to more.
    record = { ...record, aiCalls: record.aiCalls + 1, aiFor: nagAiKey(record.persona, record.level, open), aiFetchedAt: now.getTime() };
    if (!(await saveNagRecord(record))) return;
    try {
      // The open tasks, the persona and the level; not the user's name (no
      // AI request carries it, as the privacy policy says).
      const { lines } = await request({
        persona: record.persona,
        level: record.level,
        tasks: open,
        count: record.total,
        timeoutMs: NAG_REQUEST_TIMEOUT_MS,
      });
      const next = applyAiNagLines(record, lines, open, new Date(Math.max(Date.now(), now.getTime())));
      if (await saveNagRecord(next)) {
        record = next;
        onChange?.(record.version);
      }
    } catch {
      // Offline, a timeout, a refusal, an unusable answer: the built-in lines stay.
    }
  }
  // A count and where the lines came from, never the lines.
  if (planned || asked) track("nag_lines_loaded", { source: record.source, count: record.lines.length });
}

/**
 * The nags for today from the saved record (see nagPlanFromRecord). Reads
 * storage only: no network, and it never rejects (anything wrong is an empty
 * plan).
 */
export const nagStrategy: ReminderStrategy = async (context) => {
  try {
    return nagPlanFromRecord(await loadNagRecord(), context);
  } catch {
    return [];
  }
};

/** The calm plan's morning nudges: the upcoming mornings, and today's while nothing is picked. */
function mornings(calm: ReminderPlan): ReminderPlan {
  return calm.filter((item) => item.kind === "morning");
}

/**
 * The store's strategy. Calm (or nag mode without Plus, permission or
 * reminders on): the task-aware reminders. Nag mode: the morning nudges stay
 * and the daytime and evening task nudges are replaced by the day's nags.
 * Paused today: the mornings only. No record for today yet (the lines are on
 * their way, or storage failed): the calm reminders, for now.
 */
export const nagModeStrategy: ReminderStrategy = async (context) => {
  const calm = taskAwareStrategy(context);
  if (!nagModeOn(context.settings, context.plus === true, context.permissionState)) return calm;
  if (context.settings.nagPausedDate === context.today) return mornings(calm);
  let record: NagDayRecord | null = null;
  try {
    record = await loadNagRecord();
  } catch {
    record = null;
  }
  if (!nagRecordApplies(record, context)) return calm;
  const taken = new Set<string>();
  return [...mornings(calm), ...nagPlanFromRecord(record, context)].filter((item) => {
    if (taken.has(item.id)) return false;
    taken.add(item.id);
    return true;
  });
};
