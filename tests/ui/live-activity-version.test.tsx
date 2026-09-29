// Live Activities start on iOS 17.2+ only (1.3, PR F).
import { supportsLiveActivityStart } from "@/lib/daily-tasks/live-activity";

describe("supportsLiveActivityStart", () => {
  it("is 17.2 or later; an unreadable version is left to the module", () => {
    expect(supportsLiveActivityStart("17.2")).toBe(true);
    expect(supportsLiveActivityStart("18.0")).toBe(true);
    expect(supportsLiveActivityStart("17.1.2")).toBe(false);
    expect(supportsLiveActivityStart("17")).toBe(false);
    expect(supportsLiveActivityStart("16.4")).toBe(false);
    expect(supportsLiveActivityStart("")).toBe(true);
  });
});
