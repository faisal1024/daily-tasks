// PR #83 review: one numberWord() for the suggestions header and the evening draft.
import { describe, expect, it } from "vitest";

import { numberWord } from "../lib/daily-tasks/number-word";

describe("numberWord", () => {
  it("says small counts as words and the rest as digits", () => {
    expect([0, 1, 2, 3].map(numberWord)).toEqual(["no", "one", "two", "three"]);
    expect(numberWord(4)).toBe("4");
    expect(numberWord(12)).toBe("12");
  });
});
