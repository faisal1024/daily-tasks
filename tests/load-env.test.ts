import { describe, expect, it } from "vitest";

import { parseEnv } from "../server/load-env.mjs";

describe("parseEnv", () => {
  it("parses simple key=value lines", () => {
    expect(parseEnv("A=1\nB=two")).toEqual({ A: "1", B: "two" });
  });

  it("skips blanks and comments, trims whitespace", () => {
    expect(parseEnv("\n# comment\n  A = 1  \n")).toEqual({ A: "1" });
  });

  it("keeps '=' inside values (e.g. keys/urls)", () => {
    expect(parseEnv("URL=https://x/y?a=b&c=d")).toEqual({
      URL: "https://x/y?a=b&c=d",
    });
  });

  it("strips matching surrounding quotes only", () => {
    expect(parseEnv(`A="quoted"\nB='single'\nC="`)).toEqual({
      A: "quoted",
      B: "single",
      C: '"', // lone quote is left as-is (length < 2 guard)
    });
  });

  it("handles CRLF line endings", () => {
    expect(parseEnv("A=1\r\nB=2\r\n")).toEqual({ A: "1", B: "2" });
  });

  it("ignores lines without an '='", () => {
    expect(parseEnv("NOPE\nA=1")).toEqual({ A: "1" });
  });
});
