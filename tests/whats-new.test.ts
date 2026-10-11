// What's new (1.4): who is shown an announcement, how `whatsNewSeen` is
// saved and loaded, and the "Meet Nag mode" sheet's words and preview lines.
import { afterEach, describe, expect, it } from "vitest";

import { NAG_LEVELS, NAG_PERSONAS, NAG_TEMPLATES, nagTaskName } from "../lib/daily-tasks/nag";
import { NAG_CONFIRM_MESSAGE, NAG_CONFIRM_TITLE, NAG_LEVEL_COUNT_NOTE } from "../lib/daily-tasks/nag-copy";
import { NAG_LEVEL_COUNTS } from "../lib/daily-tasks/nag-plan";
import { buildInitialState, normalizeState } from "../lib/daily-tasks/storage";
import { DEFAULT_NOTIFICATIONS } from "../lib/daily-tasks/types";
import {
  __setAnnouncementsForTests,
  allAnnouncementIds,
  currentAnnouncements,
  NAG_ANNOUNCEMENT_ID,
  NAG_INTRO_COPY,
  NAG_INTRO_SETTINGS_ROW,
  NAG_ON_TOAST,
  nagIntroSamples,
  normalizeWhatsNewSeen,
  WHATS_NEW_DELAY_MS,
  whatsNewDecision,
  withWhatsNewSeen,
  type WhatsNewState,
} from "../lib/daily-tasks/whats-new";

afterEach(() => __setAnnouncementsForTests(null));

const state = (overrides: Partial<WhatsNewState> = {}): WhatsNewState => ({
  hasSeenOnboarding: true,
  whatsNewSeen: [],
  notifications: DEFAULT_NOTIFICATIONS,
  ...overrides,
});

describe("who is shown what's new", () => {
  it("1.4 announces Nag mode, under an id analytics will accept", () => {
    expect(allAnnouncementIds()).toEqual(["1.4-nag"]);
    expect(NAG_ANNOUNCEMENT_ID).toBe("1.4-nag");
    // The shape analytics keeps for a string property (sanitizeProps).
    expect(NAG_ANNOUNCEMENT_ID).toMatch(/^[a-z0-9_.-]{1,40}$/i);
  });

  it("someone who used the app before 1.4 (onboarding done, none seen) is shown it", () => {
    expect(whatsNewDecision(state())).toEqual({ show: currentAnnouncements()[0], skip: [] });
  });

  it("not before first run has finished", () => {
    expect(whatsNewDecision(state({ hasSeenOnboarding: false }))).toEqual({ show: null, skip: [] });
  });

  it("not once it has been seen", () => {
    expect(whatsNewDecision(state({ whatsNewSeen: ["1.4-nag"] }))).toEqual({ show: null, skip: [] });
  });

  it("someone with Nag as their saved style isn't shown it: it is marked seen instead", () => {
    const nag = { ...DEFAULT_NOTIFICATIONS, style: "nag" as const, nagConfirmed: true };
    expect(whatsNewDecision(state({ notifications: nag }))).toEqual({ show: null, skip: ["1.4-nag"] });
  });

  it("a later release: the oldest unseen one shows, one at a time, and an id from another build is ignored", () => {
    const list = [{ id: "1.4-nag" }, { id: "1.5-a" }, { id: "1.6-b", alreadyUsing: () => true }];
    expect(whatsNewDecision(state(), list)).toEqual({ show: list[0], skip: ["1.6-b"] });
    expect(whatsNewDecision(state({ whatsNewSeen: ["1.4-nag", "9.9-gone"] }), list)).toEqual({ show: list[1], skip: ["1.6-b"] });
    expect(whatsNewDecision(state({ whatsNewSeen: ["1.4-nag", "1.5-a", "1.6-b"] }), list)).toEqual({ show: null, skip: [] });
  });

  it("waits a moment after Today goes idle", () => {
    expect(WHATS_NEW_DELAY_MS).toBe(600);
  });
});

describe("whatsNewSeen in the saved state", () => {
  it("a new install starts with none (first run marks them when it ends)", () => {
    const fresh = buildInitialState(new Date(2026, 9, 12));
    expect(fresh.whatsNewSeen).toEqual([]);
    expect(fresh.hasSeenOnboarding).toBe(false);
    expect(whatsNewDecision(fresh).show).toBeNull();
  });

  it("a state saved before 1.4 (no field) loads, with none seen: an updater", () => {
    const { whatsNewSeen: _dropped, ...old } = { ...buildInitialState(new Date(2026, 9, 1)), hasSeenOnboarding: true };
    const loaded = normalizeState(JSON.parse(JSON.stringify(old)));
    expect(loaded).not.toBeNull();
    expect(loaded!.whatsNewSeen).toEqual([]);
    expect(whatsNewDecision(loaded!).show?.id).toBe("1.4-nag");
  });

  it("a much older save without hasSeenOnboarding counts as an updater too", () => {
    const { whatsNewSeen: _a, hasSeenOnboarding: _b, reorderHintSeen: _c, ...old } = buildInitialState(new Date(2026, 5, 1));
    const loaded = normalizeState(JSON.parse(JSON.stringify(old)))!;
    expect(loaded.hasSeenOnboarding).toBe(true);
    expect(whatsNewDecision(loaded).show?.id).toBe("1.4-nag");
  });

  it("round-trips what was seen", () => {
    const saved = { ...buildInitialState(new Date(2026, 9, 12)), hasSeenOnboarding: true, whatsNewSeen: ["1.4-nag"] };
    const loaded = normalizeState(JSON.parse(JSON.stringify(saved)))!;
    expect(loaded.whatsNewSeen).toEqual(["1.4-nag"]);
    expect(whatsNewDecision(loaded).show).toBeNull();
  });

  it("damaged values load as a clean list", () => {
    expect(normalizeWhatsNewSeen(undefined)).toEqual([]);
    expect(normalizeWhatsNewSeen("1.4-nag")).toEqual([]);
    expect(normalizeWhatsNewSeen({ 0: "1.4-nag" })).toEqual([]);
    expect(normalizeWhatsNewSeen(["1.4-nag", 7, null, "", "1.4-nag", "has space", "x".repeat(41), "1.5-next"])).toEqual([
      "1.4-nag",
      "1.5-next",
    ]);
    expect(normalizeWhatsNewSeen(Array.from({ length: 500 }, (_, index) => `id-${index}`))).toHaveLength(100);
  });

  it("marking seen adds each id once and keeps the same list when nothing is new", () => {
    const seen = ["1.4-nag"];
    expect(withWhatsNewSeen(seen, ["1.4-nag"])).toBe(seen);
    expect(withWhatsNewSeen(seen, [])).toBe(seen);
    expect(withWhatsNewSeen(seen, ["1.5-a", "1.5-a", "1.4-nag"])).toEqual(["1.4-nag", "1.5-a"]);
    expect(seen).toEqual(["1.4-nag"]);
  });
});

describe("the Meet Nag mode sheet's words", () => {
  const strings = [
    NAG_INTRO_COPY.label,
    NAG_INTRO_COPY.title,
    NAG_INTRO_COPY.lede,
    NAG_INTRO_COPY.voice,
    NAG_INTRO_COPY.level,
    NAG_INTRO_COPY.another,
    ...NAG_INTRO_COPY.points.map((point) => point.text),
    NAG_INTRO_COPY.plus,
    NAG_INTRO_COPY.primary,
    NAG_INTRO_COPY.secondary,
    NAG_INTRO_COPY.footer,
    NAG_INTRO_COPY.close,
    NAG_ON_TOAST,
    NAG_INTRO_SETTINGS_ROW,
  ];

  it("are the agreed ones", () => {
    expect(NAG_INTRO_COPY.label).toBe("New in 1.4");
    expect(NAG_INTRO_COPY.title).toBe("Meet Nag mode");
    expect(NAG_INTRO_COPY.lede).toBe("Reminders with a personality. Pick who nags you and how hard.");
    expect(NAG_INTRO_COPY.points.map((point) => point.text)).toEqual([
      "Random times, at most one an hour.",
      "Gets pushier while your tasks stay open.",
      "One tap stops it for the day. It never breaks through a Focus.",
    ]);
    expect(NAG_INTRO_COPY.plus).toBe("Nag mode is part of Plus. Calm reminders stay free.");
    expect(NAG_INTRO_COPY.primary).toBe("Try Nag mode");
    expect(NAG_INTRO_COPY.secondary).toBe("Not now");
    expect(NAG_INTRO_COPY.footer).toBe(
      "Also new: drag to reorder your three, reminders that name your tasks, and ideas for your next milestone.",
    );
    expect(NAG_ON_TOAST).toBe("Nag mode is on. Change it in Settings › Reminders.");
    expect(NAG_INTRO_SETTINGS_ROW).toBe("What is Nag mode?");
  });

  it("have no dashes, and say nothing about the AI (the turn-on question does)", () => {
    for (const text of strings) {
      expect(text).not.toMatch(/[—–]/);
      expect(text).not.toMatch(/\bAI\b|artificial|GPT|model/i);
    }
    expect(`${NAG_CONFIRM_TITLE} ${NAG_CONFIRM_MESSAGE}`).toMatch(/sent to our AI service/);
  });

  it("the level line is the one Settings shows", () => {
    expect(NAG_LEVELS.map((level) => NAG_LEVEL_COUNT_NOTE[level])).toEqual(["About 4 a day", "About 7 a day", "About 11 a day"]);
  });
});

describe("the preview's lines", () => {
  const every = NAG_PERSONAS.flatMap((persona) => NAG_LEVELS.map((level) => ({ persona, level })));

  it("are built-in lines of that voice, as many as the level's day, none twice", () => {
    for (const { persona, level } of every) {
      const general = nagIntroSamples({ persona, level, taskText: null });
      const templates = NAG_TEMPLATES[persona];
      const pool = [
        ...templates.early,
        ...templates.mid.gentle,
        ...templates.mid.firm,
        ...templates.late.gentle,
        ...templates.late.firm,
        ...templates.late.relentless,
      ];
      expect(general).toHaveLength(NAG_LEVEL_COUNTS[level]);
      expect(new Set(general).size).toBe(general.length);
      for (const line of general) {
        expect(pool).toContain(line);
        expect(line).not.toContain("{task}");
      }
    }
  });

  it("with an open task the first line names it; with none (or names hidden) no line names a task", () => {
    for (const { persona, level } of every) {
      const named = nagIntroSamples({ persona, level, taskText: "Call the dentist" });
      expect(named[0]).toContain(nagTaskName("Call the dentist"));
      expect(named).toHaveLength(NAG_LEVEL_COUNTS[level]);
      // The general ones follow the ones that name it.
      const firstGeneral = named.findIndex((line) => !line.includes("Call the dentist"));
      expect(named.slice(firstGeneral).every((line) => !line.includes("Call the dentist"))).toBe(true);
      for (const line of nagIntroSamples({ persona, level, taskText: null })) expect(line).not.toContain("dentist");
    }
  });

  it("the pushiest comes first, so the level shows: Relentless opens on a relentless line, Gentle never leaves gentle", () => {
    for (const persona of NAG_PERSONAS) {
      const templates = NAG_TEMPLATES[persona];
      expect(templates.late.relentless).toContain(nagIntroSamples({ persona, level: "relentless", taskText: null })[0]);
      expect(templates.late.firm).toContain(nagIntroSamples({ persona, level: "firm", taskText: null })[0]);
      const gentle = nagIntroSamples({ persona, level: "gentle", taskText: null });
      expect(templates.late.gentle).toContain(gentle[0]);
      const mild = [...templates.early, ...templates.mid.gentle, ...templates.late.gentle];
      for (const line of gentle) expect(mild).toContain(line);
    }
  });

  it("is the same every time (nothing random, nothing fetched)", () => {
    const input = { persona: "coach", level: "firm", taskText: "Walk" } as const;
    expect(nagIntroSamples(input)).toEqual(nagIntroSamples(input));
  });

  it("a long or odd task name is cleaned and cut as in a real nag", () => {
    const text = `  Write   the ${"very ".repeat(20)}long report!!  `;
    const first = nagIntroSamples({ persona: "mom", level: "firm", taskText: text })[0];
    expect(first).toContain(nagTaskName(text));
    expect(first.length).toBeLessThanOrEqual(110);
  });
});
