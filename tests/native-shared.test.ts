// The focus session's Live Activity attributes are compiled into both the app
// (modules/focus-activity) and the widget extension (targets/widget):
// ActivityKit pairs them by type name and shape, so the two copies must match.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseFocusCommands } from "../lib/daily-tasks/focus-commands";
import { parseFocusStartLink, parseFocusStartRequest } from "../lib/daily-tasks/focus-link";
import { notificationBody, startSession } from "../lib/daily-tasks/focus-session";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

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
    expect(swift).toContain('static let timerCategoryId = "three-today:focus-session"');
    expect(read("lib/daily-tasks/notifications.ts")).toContain('FOCUS_CATEGORY_ID = "three-today:focus-session"');
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
