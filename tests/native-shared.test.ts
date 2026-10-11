// The focus session's Live Activity attributes are compiled into both the app
// (modules/focus-activity) and the widget extension (targets/widget):
// ActivityKit pairs them by type name and shape, so the two copies must match.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseFocusCommands } from "../lib/daily-tasks/focus-commands";
import { parseFocusStartLink, parseFocusStartRequest } from "../lib/daily-tasks/focus-link";
import { keepGoing, notificationBody, notificationTitle, startSession } from "../lib/daily-tasks/focus-session";
import { buildReminderIdentifier, MANAGED_REMINDER_PREFIX } from "../lib/daily-tasks/reminders";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

// PR #89: a tick the app can't see (the widget, the Live Activity's Done)
// removes the app's pending reminders once nothing is open. The native side
// finds them by the same id shape the app schedules them with.
describe("native tick paths and the app's reminders", () => {
  const swift = read("targets/widget/FocusActivityShared.swift");

  it("uses the app's reminder id prefix, and clears today's ids only (tomorrow morning's nudge stays)", () => {
    expect(swift).toContain(`static let reminderPrefix = "${MANAGED_REMINDER_PREFIX}"`);
    const at = new Date(2026, 9, 13, 8, 0);
    expect(buildReminderIdentifier("morning", at)).toBe("daily-tasks:2026-10-13:morning:0800");
    // Today's: "<prefix><yyyy-MM-dd>:". That is the only thing matched: a
    // tick on the widget can't write tomorrow's nudge again, so it must not
    // remove it (the app may not be opened before it is due).
    const clear = swift.slice(swift.indexOf("static func clearRemindersIfAllDone"), swift.indexOf('/// "Start my next task"'));
    expect(clear).toContain(String.raw`let todayPrefix = "\(reminderPrefix)\(today):"`);
    expect(clear).toContain("let ids = pending.map { $0.identifier }.filter { $0.hasPrefix(todayPrefix) }");
    expect(clear).toContain("center.removePendingNotificationRequests(withIdentifiers: ids)");
    expect(clear.match(/hasPrefix\(/g)).toHaveLength(1);
    expect(clear).not.toMatch(/tomorrow|morning|byAdding/i);
    // Tomorrow's nudge isn't under today's prefix, whatever its kind.
    const todayPrefix = `${MANAGED_REMINDER_PREFIX}2026-10-12:`;
    expect(buildReminderIdentifier("morning", at).startsWith(todayPrefix)).toBe(false);
    expect(buildReminderIdentifier("evening", new Date(2026, 9, 12, 19, 0)).startsWith(todayPrefix)).toBe(true);
    // Only by removing listed ids: never everything, never the focus timer's by accident.
    expect(swift).not.toContain("removeAllPendingNotificationRequests");
  });

  it("both tick paths clear them, after the tick is saved and outside the lock", () => {
    const intent = read("targets/widget/ToggleTaskIntent.swift");
    expect(intent.indexOf("FocusGroup.withLock { apply() }")).toBeGreaterThan(-1);
    expect(intent.indexOf("await FocusGroup.clearRemindersIfAllDone()")).toBeGreaterThan(
      intent.indexOf("FocusGroup.withLock { apply() }"),
    );
    const done = swift.slice(swift.indexOf("public static func done("), swift.indexOf("static func reflectApp("));
    expect(done.indexOf("await FocusGroup.clearRemindersIfAllDone()")).toBeGreaterThan(
      done.indexOf("FocusGroup.markDoneInSnapshot(taskId: taskId, date: date)"),
    );
    // Nothing goes while a task is still open, or for another day's snapshot.
    const clear = swift.slice(swift.indexOf("static func clearRemindersIfAllDone"), swift.indexOf('/// "Start my next task"'));
    expect(clear).toContain('snapshot["date"] as? String == today');
    expect(clear).toContain('!tasks.isEmpty, !tasks.contains(where: { ($0["done"] as? Bool) != true })');
  });
});

describe("shared Swift sources", () => {
  it("keeps FocusActivityShared.swift identical in the app module and the widget", () => {
    const app = read("modules/focus-activity/ios/FocusActivityShared.swift");
    const widget = read("targets/widget/FocusActivityShared.swift");
    const line = app.split("\n").findIndex((text, i) => text !== widget.split("\n")[i]);
    expect(
      app === widget,
      `FocusActivityShared.swift differs between modules/focus-activity/ios and targets/widget (first at line ${line + 1}). ` +
        "Edit one and copy it over: cp targets/widget/FocusActivityShared.swift modules/focus-activity/ios/",
    ).toBe(true);
  });

  it("points the app and the widget at the same App Group and keys as the JS bridge", () => {
    const swift = read("targets/widget/FocusActivityShared.swift");
    const bridge = read("lib/daily-tasks/widget-bridge.ts");
    for (const key of ["focus.session", "focus.commands", "focus.processedSeq", "focus.startRequest", "widget.toggles"]) {
      expect(swift).toContain(`"${key}"`);
      expect(bridge).toContain(`"${key}"`);
    }
    expect(swift).toContain('"group.com.faisalislam.dailytasks"');
    expect(swift).toContain('"three-today:focus-timer"');
    expect(read("lib/daily-tasks/notifications.ts")).toContain('"three-today:focus-timer"');
  });

  // U4: a starter's Keep going on the lock screen re-schedules its "Time's
  // up" as a timer's, natively: the same words and category as the app's.
  it("the native timer notification body and category match the app's", () => {
    const swift = read("targets/widget/FocusActivityShared.swift");
    const timer = startSession({
      id: "s",
      taskId: "t",
      taskText: "Walk",
      kind: "timer",
      minutes: 10,
      date: "2026-09-26",
      now: 0,
    });
    expect(swift).toContain(`static let timerNotificationBody = "${notificationBody(timer)}"`);
    // With names hidden the title already says "Time's up": the body the
    // native side writes under it doesn't say it again.
    expect(swift).toContain(`static let hiddenNotificationTitle = "${notificationTitle(timer, true)}"`);
    expect(swift).toContain(`static let hiddenTimerNotificationBody = "${notificationBody(timer, true)}"`);
    expect(notificationBody(timer, true)).not.toContain(notificationTitle(timer, true));
    // The app's own path: a starter kept going is a timer, and hidden it reads "Time's up" once.
    const starter = startSession({ id: "s", taskId: "t", taskText: "Walk", kind: "starter", minutes: 5, date: "2026-09-26", now: 0 });
    const kept = keepGoing(starter, 5 * 60_000);
    expect(`${notificationTitle(kept, true)} ${notificationBody(kept, true)}`).toBe("Time's up 5 more minutes, or mark it done?");
    expect(`${notificationTitle(starter, true)} ${notificationBody(starter, true)}`.match(/Time's up/g)).toHaveLength(1);
    const repeat = swift.slice(swift.indexOf("static func repeatDeliveredNotification"), swift.indexOf("static func schedule("));
    expect(repeat.replace(/\s+/g, " ")).toContain(
      "timer.body = last.request.content.title == FocusGroup.hiddenNotificationTitle ? FocusGroup.hiddenTimerNotificationBody : FocusGroup.timerNotificationBody",
    );
    expect(swift).toContain('static let timerCategoryId = "three-today:focus-session"');
    expect(read("lib/daily-tasks/notifications.ts")).toContain('FOCUS_CATEGORY_ID = "three-today:focus-session"');
  });

  // Owner feedback: ending a timer isn't finishing the task, so the button
  // that ticks it says so everywhere: "Mark done" on the Live Activity, the
  // Dynamic Island (the same FocusButtons) and both notification categories.
  it("the Live Activity and the notifications call the ticking button Mark done (never a bare Done)", () => {
    const activity = read("targets/widget/FocusLiveActivity.swift");
    expect(activity).toContain('"Mark done", solid: false');
    expect(activity).toContain('.accessibilityLabel("Mark task done")');
    expect(activity).toContain('.accessibilityHint("Ticks off \\(state.taskText)")');
    expect(activity).not.toMatch(/"Done", "checkmark"/);
    const notifications = read("lib/daily-tasks/notifications.ts");
    expect(notifications.match(/identifier: FOCUS_ACTION_DONE, buttonTitle: "Mark done"/g)).toHaveLength(2);
    expect(notifications).not.toContain('buttonTitle: "Done"');
  });

  // PR #76 review: no one-tap tick on the lock screen while the timer runs.
  // Running: Pause; paused: Resume; time's up: extend (solid), Take a break,
  // Mark done, in that order.
  it("the Live Activity's buttons by state: only Pause / Resume mid-session; extend, break and Mark done at time's up", () => {
    const activity = read("targets/widget/FocusLiveActivity.swift");
    const buttons = activity.slice(activity.indexOf("struct FocusButtons"), activity.indexOf("// MARK: - Lock screen"));
    const section = (from: string, to: string) => buttons.slice(buttons.indexOf(from), buttons.indexOf(to));
    const running = section("case .running:", "case .paused:");
    const paused = section("case .paused:", "case .timesUp:");
    const timesUp = section("case .timesUp:", "default:");
    expect(running).toContain("FocusPauseIntent");
    expect(paused).toContain("FocusResumeIntent");
    for (const mid of [running, paused]) {
      expect(mid).not.toContain("FocusDoneIntent");
      expect(mid).not.toContain("FocusBreakIntent");
    }
    const order = ["FocusExtendIntent", "FocusBreakIntent", "FocusDoneIntent"].map((name) => timesUp.indexOf(name));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(timesUp).toContain("state.extendTitle, solid: true");
    expect(timesUp).toContain("state.breakTitle, solid: false");
    // Nothing outside the switch adds a button in every state.
    expect(buttons.split("FocusDoneIntent(").length - 1).toBe(1);
    // The words match the app's check-in.
    expect(activity).toContain('var breakTitle: String { kind == "starter" ? "Stop for now" : "Take a break" }');
    expect(read("lib/daily-tasks/focus-session.ts")).toContain('session.kind === "starter" ? "Stop for now" : "Take a break"');
    expect(activity).toContain('status == "break" ? "Timer ended" : "Timer stopped"');
  });

  it("Take a break on the lock screen queues a break command the app understands", () => {
    const intents = read("targets/widget/FocusIntents.swift");
    expect(intents).toMatch(/struct FocusBreakIntent: LiveActivityIntent[\s\S]*?FocusActions\.takeBreak\(sessionId: sessionId\)/);
    const shared = read("targets/widget/FocusActivityShared.swift");
    expect(shared).toContain('FocusGroup.appendCommand("break", sessionId: sessionId');
    expect(shared).toContain('await end(sessionId: sessionId, finalStatus: "break", dismissAfter: finalDismissSeconds)');
    const [command] = parseFocusCommands(JSON.stringify([{ seq: 1, sessionId: "s", action: "break", at: 1 }]), 0);
    expect(command?.action).toBe("break");
  });

  // Each App Group key, by what it's for: the Swift constant (FocusGroup in
  // FocusActivityShared.swift, Shared.swift for the widget's own) and the
  // TS constant in widget-bridge.ts must hold the same string.
  it("App Group key names: each Swift constant equals its TS constant", () => {
    const shared = read("targets/widget/FocusActivityShared.swift");
    const widget = read("targets/widget/Shared.swift");
    const bridge = read("lib/daily-tasks/widget-bridge.ts");
    const swiftConst = (source: string, name: string) =>
      new RegExp(`static let ${name}\\s*=\\s*"([^"]+)"`).exec(source)?.[1];
    const tsConst = (name: string) => new RegExp(`const ${name}\\s*=\\s*"([^"]+)"`).exec(bridge)?.[1];
    const pairs: [string, string, string][] = [
      ["sessionKey", "FOCUS_SESSION_KEY", "focus.session"],
      ["commandsKey", "FOCUS_COMMANDS_KEY", "focus.commands"],
      ["commandsProcessedKey", "FOCUS_COMMANDS_PROCESSED_KEY", "focus.processedSeq"],
      ["startRequestKey", "FOCUS_START_REQUEST_KEY", "focus.startRequest"],
      ["snapshotKey", "SNAPSHOT_KEY", "widget.snapshot"],
      ["togglesKey", "TOGGLES_KEY", "widget.toggles"],
      ["togglesProcessedKey", "PROCESSED_KEY", "widget.processedSeq"],
      ["group", "APP_GROUP", "group.com.faisalislam.dailytasks"],
      ["widgetKind", "WIDGET_KIND", "DailyTasksWidget"],
    ];
    for (const [swiftName, tsName, value] of pairs) {
      expect({ key: swiftName, value: swiftConst(shared, swiftName) }).toEqual({ key: swiftName, value });
      expect({ key: tsName, value: tsConst(tsName) }).toEqual({ key: tsName, value });
    }
    // The widget's own copy of its three keys (Shared.swift) agrees too.
    for (const key of ["widget.snapshot", "widget.toggles", "widget.processedSeq"]) expect(widget).toContain(`"${key}"`);
    // No Swift file uses a focus./widget. key the app doesn't know.
    const known = new Set([...pairs.map(([, , value]) => value), "focus.heldNotification", "focus.heldNotificationSession"]);
    for (const path of [
      "targets/widget/FocusActivityShared.swift",
      "targets/widget/FocusIntents.swift",
      "targets/widget/FocusLiveActivity.swift",
      "targets/widget/DailyTasksWidget.swift",
      "targets/widget/Shared.swift",
      "modules/focus-activity/ios/FocusActivityModule.swift",
      "native/app/FocusShortcuts.swift",
    ]) {
      for (const [, key] of read(path).matchAll(/"((?:focus|widget)\.[A-Za-z.]+)"/g)) {
        expect({ path, key, known: known.has(key) }).toEqual({ path, key, known: true });
      }
    }
  });

  it("the JSON shapes native writes are the ones the app reads (mirror, commands, start request, link)", () => {
    const shared = read("targets/widget/FocusActivityShared.swift");
    const fields = (struct: string) => {
      const body = new RegExp(`struct ${struct}[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(shared)?.[1] ?? "";
      return [...body.matchAll(/^\s*public (?:var|let) (\w+):[^{\n]*$/gm)].map((match) => match[1]).sort();
    };
    // focus.session: Swift decodes exactly what the app mirrors ({v, rev, ...session}).
    const session = startSession({ id: "s", taskId: "t", taskText: "x", date: "2026-09-29", kind: "timer", minutes: 5, now: 0 });
    expect(fields("FocusSessionMirror")).toEqual(["v", "rev", ...Object.keys(session)].sort());
    // focus.commands: what Swift appends, the app parses.
    expect(fields("FocusCommand")).toEqual(["action", "at", "seq", "sessionId"]);
    expect(parseFocusCommands(JSON.stringify([{ seq: 1, sessionId: "s", action: "pause", at: 1790669100000 }]), 0)).toHaveLength(1);
    // widget.toggles: Done from the Live Activity carries its source.
    expect(fields("QueuedToggle")).toEqual(["date", "done", "id", "seq", "source"]);
    expect(shared).toContain('source: "live_activity"');
    // focus.startRequest: requestStart's keys.
    expect(shared).toMatch(/\["id": id, "kind": kind, "source": source, "at": nowMs\(\)\]/);
    expect(shared).toContain('URLQueryItem(name: "id", value: id)');
    expect(parseFocusStartRequest(JSON.stringify({ id: "u", kind: "starter", source: "siri", at: 1000 }), null, 1000)).toEqual({
      id: "u",
      kind: "starter",
      source: "siri",
    });
    // startURL: dailytasks://focus/start?task=next&source=…[&kind=starter].
    expect(shared).toContain('components.scheme = "dailytasks"');
    expect(shared).toContain('components.host = "focus"');
    expect(shared).toContain('components.path = "/start"');
    expect(read("app.config.ts")).toMatch(/scheme:\s*"dailytasks"/);
    expect(parseFocusStartLink("dailytasks://focus/start?task=next&source=siri&kind=starter")).toEqual({
      kind: "starter",
      source: "siri",
    });
  });
});
