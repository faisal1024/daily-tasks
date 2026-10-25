// 1.4.1: the Dad voice meets every rule the older voices meet (built-in
// pool and the Worker), and "spouse" stays the id of the voice shown as
// "Partner". Most pool rules are checked for every persona in
// nag-lines.test.ts and nag-tone.test.ts; these are the ones that name a
// voice, so Dad can't slip past a list that was written before him.
import { describe, expect, it } from "vitest";

import { isAffectionateNagLine, NAG_BUILT_IN_MAX_CHARS, NAG_DRILL_RUDE, NAG_PERSONA_LABELS, NAG_TEMPLATES, nagTaskName, nagTitle } from "../lib/daily-tasks/nag";
import * as server from "../server/providers/nag-contract.mjs";

const dad = NAG_TEMPLATES.dad;
const pools = { early: dad.early, midGentle: dad.mid.gentle, midFirm: dad.mid.firm, lateGentle: dad.late.gentle, lateFirm: dad.late.firm, lateRelentless: dad.late.relentless };
const lines = Object.values(pools).flat();
const LONG_TASK = "Reorganise the whole garage shelving unit before the weekend"; // 60 characters

describe("the built-in Dad pool", () => {
  it("has Mom's shape: 34 different lines, every pool with a general line and a {task} line", () => {
    expect(Object.values(pools).map((pool) => pool.length)).toEqual([10, 5, 5, 4, 5, 5]);
    expect(new Set(lines).size).toBe(34);
    for (const pool of Object.values(pools)) {
      expect(pool.some((line) => line.includes("{task}"))).toBe(true);
      expect(pool.some((line) => !line.includes("{task}"))).toBe(true);
    }
  });

  it("passes the Worker's whole blocklist and clock-word check with no allowance, is never rude, never affectionate, and fits the cap", () => {
    for (const template of lines) {
      const text = template.replace("{task}", nagTaskName(LONG_TASK));
      expect(Array.from(text).length, text).toBeLessThanOrEqual(NAG_BUILT_IN_MAX_CHARS);
      // No persona argument: the strictest reading, as for Mom, Partner and Coach.
      expect(server.hitsNagBlocklist(template.replace("{task}", "it")), template).toBe(false);
      expect(server.hasNagClockWord(template.replace("{task}", "it")), template).toBe(false);
      expect(NAG_DRILL_RUDE.test(template), template).toBe(false);
      expect(isAffectionateNagLine(template), template).toBe(false);
      expect(template, template).not.toMatch(/\b(?:kiddo|sport|son|buddy|champ|dad|father)\b/i);
    }
  });
});

describe("the Worker and Dad", () => {
  it("accepts persona dad, with every level", () => {
    for (const level of server.NAG_LEVELS) {
      expect(server.validateNagPayload({ persona: "dad", level, tasks: [{ text: "Call the dentist" }], count: 5 })).toBeNull();
    }
  });

  it("gives Dad the one-emoji allowance Mom and Partner have, and still none to Coach", () => {
    const text = "Still open 😊 friend 🙄🙄 ok";
    expect(server.cleanNagLine(text, { persona: "dad" })).toBe("Still open 😊 friend ok");
    expect(server.cleanNagLine(text, { persona: "coach" })).toBe("Still open friend ok");
  });

  it("blocks the pet name 'kiddo' for every voice", () => {
    for (const persona of server.NAG_PERSONAS) {
      expect(server.cleanNagLine("Kiddo, the list is still open.", { persona }), persona).toBe("");
    }
    expect(server.hitsNagBlocklist("Kiddo, the list.", [], "dad")).toBe(true);
  });

  it("describes Dad as a type with no pet names, and Partner under the old 'spouse' id", () => {
    expect(server.NAG_PERSONA_VOICES.dad).toMatch(/^Dad\./);
    expect(server.NAG_PERSONA_VOICES.dad).toMatch(/no pet names/i);
    expect(server.NAG_PERSONA_VOICES.spouse).toMatch(/^Partner\./);
  });
});

describe("Partner", () => {
  it("is shown as Partner (and titled so) while the id stays spouse", () => {
    expect(NAG_PERSONA_LABELS.spouse).toBe("Partner");
    expect(nagTitle("spouse")).toBe("Three Today · Partner");
    expect(Object.keys(NAG_PERSONA_LABELS)).not.toContain("partner");
    expect(server.NAG_PERSONAS).toContain("spouse");
    expect(server.NAG_PERSONAS).not.toContain("partner");
  });
});
