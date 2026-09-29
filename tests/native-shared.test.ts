// The focus session's Live Activity attributes are compiled into both the app
// (modules/focus-activity) and the widget extension (targets/widget):
// ActivityKit pairs them by type name and shape, so the two copies must match.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("shared Swift sources", () => {
  it("keeps FocusActivityShared.swift identical in the app module and the widget", () => {
    expect(read("modules/focus-activity/ios/FocusActivityShared.swift")).toBe(
      read("targets/widget/FocusActivityShared.swift"),
    );
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
});
