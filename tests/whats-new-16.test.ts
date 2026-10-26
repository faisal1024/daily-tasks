// What's new in 1.6 (with 1.5's coach memory, which ships inside it): who is
// shown it (updaters only, once, and alone when 1.4's is unseen too), which
// cards show with Nag mode on or off and with or without Plus, the words,
// the Settings focus queue, and Saved for later's "add a day" tip.
import { afterEach, describe, expect, it } from "vitest";

import { showSavedDateTip, withSavedDateTip, SAVED_DATE_TIP } from "../lib/daily-tasks/saved-date-tip";
import { requestSettingsFocus, subscribeSettingsFocus, takeSettingsFocus } from "../lib/daily-tasks/settings-focus";
import { buildInitialState, normalizeState } from "../lib/daily-tasks/storage";
import { parkTasks } from "../lib/daily-tasks/task-extras";
import { DEFAULT_NOTIFICATIONS, type AppState } from "../lib/daily-tasks/types";
import {
  __setAnnouncementsForTests,
  allAnnouncementIds,
  FEATURES_16_ANNOUNCEMENT,
  FEATURES_16_ID,
  NAG_ANNOUNCEMENT,
  NAG_ANNOUNCEMENT_ID,
  whatsNewDecision,
  withWhatsNewSeen,
  type WhatsNewState,
} from "../lib/daily-tasks/whats-new";
import { WHATS_NEW_16_COPY, whatsNew16Cards } from "../lib/daily-tasks/whats-new-16";

afterEach(() => __setAnnouncementsForTests(null));

const state = (overrides: Partial<WhatsNewState> = {}): WhatsNewState => ({
  hasSeenOnboarding: true,
  whatsNewSeen: [],
  notifications: DEFAULT_NOTIFICATIONS,
  ...overrides,
});
const NAG = { ...DEFAULT_NOTIFICATIONS, style: "nag" as const, nagConfirmed: true };

describe("who is shown 1.6's What's new", () => {
  it("is released after 1.4's, under an id analytics keeps", () => {
    expect(allAnnouncementIds()).toEqual([NAG_ANNOUNCEMENT_ID, FEATURES_16_ID]);
    expect(FEATURES_16_ID).toBe("1.6-features");
    expect(FEATURES_16_ID).toMatch(/^[a-z0-9_.-]{1,40}$/i);
  });

  it("someone updating from 1.4.x (1.4's seen) is shown it", () => {
    expect(whatsNewDecision(state({ whatsNewSeen: [NAG_ANNOUNCEMENT_ID] }))).toEqual({
      show: FEATURES_16_ANNOUNCEMENT,
      skip: [],
    });
  });

  it("with 1.4's and 1.6's both unseen, only 1.6's shows, and 1.4's is marked seen quietly", () => {
    expect(whatsNewDecision(state())).toEqual({ show: FEATURES_16_ANNOUNCEMENT, skip: [NAG_ANNOUNCEMENT_ID] });
    // Once that is saved, the same sheet still comes (1.4's never does).
    const after = withWhatsNewSeen([], [NAG_ANNOUNCEMENT_ID]);
    expect(whatsNewDecision(state({ whatsNewSeen: after })).show?.id).toBe(FEATURES_16_ID);
  });

  it("someone with Nag mode on already is shown 1.6's (own lines and the nag buttons are new to them)", () => {
    expect(whatsNewDecision(state({ notifications: NAG }))).toEqual({
      show: FEATURES_16_ANNOUNCEMENT,
      skip: [NAG_ANNOUNCEMENT_ID],
    });
  });

  it("a new install never sees it: first run marks every announcement seen", () => {
    const fresh = buildInitialState(new Date(2026, 9, 26));
    expect(whatsNewDecision(fresh).show).toBeNull();
    const done = { ...fresh, hasSeenOnboarding: true, whatsNewSeen: withWhatsNewSeen(fresh.whatsNewSeen, allAnnouncementIds()) };
    expect(done.whatsNewSeen).toEqual([NAG_ANNOUNCEMENT_ID, FEATURES_16_ID]);
    expect(whatsNewDecision(done)).toEqual({ show: null, skip: [] });
  });

  it("shown once: once it's marked seen nothing is left", () => {
    const seen = withWhatsNewSeen([NAG_ANNOUNCEMENT_ID], [FEATURES_16_ID]);
    expect(whatsNewDecision(state({ whatsNewSeen: seen }))).toEqual({ show: null, skip: [] });
    // Also after a save and a load.
    const saved = { ...buildInitialState(new Date(2026, 9, 26)), hasSeenOnboarding: true, whatsNewSeen: seen };
    expect(whatsNewDecision(normalizeState(JSON.parse(JSON.stringify(saved)))!).show).toBeNull();
  });

  it("a superseded announcement never shows in a build that has the newer one, seen or not", () => {
    // 1.6 seen but 1.4 not (a partial save): 1.4's is still covered, and marked seen quietly.
    expect(whatsNewDecision(state({ whatsNewSeen: [FEATURES_16_ID] }))).toEqual({ show: null, skip: [NAG_ANNOUNCEMENT_ID] });
    // Without the newer one in the build, it shows as before.
    expect(whatsNewDecision(state(), [NAG_ANNOUNCEMENT])).toEqual({ show: NAG_ANNOUNCEMENT, skip: [] });
  });

  it("nothing before first run has finished", () => {
    expect(whatsNewDecision(state({ hasSeenOnboarding: false }))).toEqual({ show: null, skip: [] });
  });
});

describe("which cards show", () => {
  const ids = (nagOn: boolean, hasPlus: boolean) => whatsNew16Cards({ nagOn, hasPlus }).map((card) => card.id);
  const card = (nagOn: boolean, hasPlus: boolean, id: string) =>
    whatsNew16Cards({ nagOn, hasPlus }).find((each) => each.id === id)!;

  it("Nag on with Plus: all five, in the owner's order, the nag one last", () => {
    expect(ids(true, true)).toEqual(["save_later", "own_lines", "sunday_reset", "coach_memory", "nag_answer"]);
  });

  it.each([
    ["Nag off with Plus", false, true],
    ["Nag off without Plus", false, false],
    // A saved Nag style without Plus behaves as Calm: Today passes nagOn false, and a stray true is ignored.
    ["Nag 'on' without Plus", true, false],
  ])("%s: four cards, no 'Answer a nag right away'", (_name, nagOn, hasPlus) => {
    expect(ids(nagOn, hasPlus)).toEqual(["save_later", "own_lines", "sunday_reset", "coach_memory"]);
  });

  it("own lines: 'Write your lines' only with Nag on and Plus, else 'Try Nag mode'", () => {
    expect(card(true, true, "own_lines").button).toMatchObject({ action: "write_lines", label: "Write your lines" });
    expect(card(false, true, "own_lines").button).toMatchObject({ action: "try_nag", label: "Try Nag mode" });
    expect(card(false, false, "own_lines").button).toMatchObject({ action: "try_nag", label: "Try Nag mode" });
    expect(card(true, false, "own_lines").button).toMatchObject({ action: "try_nag", label: "Try Nag mode" });
  });

  it("Sunday reset: 'Try it now' with Plus; without, 'See Plus' (it opens the paywall, and says so)", () => {
    expect(card(false, true, "sunday_reset").button).toEqual({ action: "try_reset", label: "Try it now" });
    expect(card(false, false, "sunday_reset").button).toEqual({
      action: "try_reset",
      label: "See Plus",
      hint: "Shows what Plus includes",
    });
  });

  it("the Plus tag shows on the Plus cards only without Plus", () => {
    const tagged = (hasPlus: boolean) =>
      whatsNew16Cards({ nagOn: false, hasPlus }).filter((each) => each.plus).map((each) => each.id);
    expect(tagged(false)).toEqual(["own_lines", "sunday_reset"]);
    expect(tagged(true)).toEqual([]);
  });

  it("each card has an icon, a title, a short body and at most one button; the nag card has none", () => {
    for (const [nagOn, hasPlus] of [
      [true, true],
      [false, false],
    ] as const) {
      for (const each of whatsNew16Cards({ nagOn, hasPlus })) {
        expect(each.icon).toMatch(/^[a-z-]+$/);
        expect(each.title.length).toBeGreaterThan(0);
        // One or two plain sentences.
        expect(each.body.split(/(?<=[.!?”])\s+(?=[A-Z])/).length).toBeLessThanOrEqual(2);
        expect(each.body.length).toBeLessThanOrEqual(140);
      }
    }
    expect(card(true, true, "nag_answer").button).toBeNull();
  });

  it("the cards' buttons send ids, never words", () => {
    const actions = whatsNew16Cards({ nagOn: true, hasPlus: true })
      .concat(whatsNew16Cards({ nagOn: false, hasPlus: false }))
      .flatMap((each) => (each.button ? [each.button.action] : []));
    for (const action of actions) expect(action).toMatch(/^[a-z_]{1,40}$/);
    expect(new Set(actions)).toEqual(new Set(["how_to", "write_lines", "try_nag", "try_reset", "coach_memory"]));
  });
});

describe("the words", () => {
  const all = () => JSON.stringify(WHATS_NEW_16_COPY);

  it("the owner's copy, exactly", () => {
    const c = WHATS_NEW_16_COPY;
    expect(c.saveLater.title).toBe("Save for later from anywhere");
    expect(c.saveLater.body).toBe(
      "Share from any app, or tell Siri “Save for later in Three Today”. Add a day (“dentist Friday”) and it comes back that day.",
    );
    expect(c.ownLines.title).toBe("Nag in your own words");
    expect(c.ownLines.example).toMatchObject({ line: "“{task}. Now. I mean it.”", filled: "“Gym. Now. I mean it.”" });
    expect(c.sundayReset.body).toBe(
      "Two quiet minutes on Sunday evening: your week's wins, a dump for the week, and Monday's three.",
    );
    expect(c.coachMemory).toMatchObject({
      title: "Your coach remembers",
      body: "It learns what you finish and what keeps getting pushed, and plans with that in mind. You can see and clear it anytime.",
      button: "See what it remembers",
    });
    expect(c.nagAnswer.body).toBe(
      "Long-press a nag to Snooze an hour or Mark it done. Nags now always fit the task they're about.",
    );
    expect(c.gotIt).toBe("Got it");
  });

  it("the example's filled line is the line with {task} as the task's name", () => {
    const { line, filled } = WHATS_NEW_16_COPY.ownLines.example;
    expect(line.replace("{task}", "Gym")).toBe(filled);
  });

  it("plain words: no em dashes, no jargon", () => {
    expect(all()).not.toMatch(/—/);
    expect(all()).not.toMatch(/\b(AI|LLM|App Group|intent|extension)\b/);
  });

  it("the how-to is three short steps: Share, Siri, the Dump widget", () => {
    const steps = WHATS_NEW_16_COPY.saveLater.steps.map((step) => step.text);
    expect(steps).toHaveLength(3);
    expect(steps[0]).toMatch(/Share.*Three Today/);
    expect(steps[1]).toContain("“Save for later in Three Today”");
    expect(steps[2]).toContain("Dump widget");
  });
});

describe("Settings focus requests", () => {
  it("one waiting request, taken once; listeners hear each one", () => {
    expect(takeSettingsFocus()).toBeNull();
    const heard: string[] = [];
    const off = subscribeSettingsFocus(() => heard.push("heard"));
    requestSettingsFocus("nag-own-lines");
    requestSettingsFocus("coach-memory");
    expect(heard).toEqual(["heard", "heard"]);
    // The latest wins.
    expect(takeSettingsFocus()).toBe("coach-memory");
    expect(takeSettingsFocus()).toBeNull();
    off();
    requestSettingsFocus("nag-own-lines");
    expect(heard).toHaveLength(2);
    expect(takeSettingsFocus()).toBe("nag-own-lines");
  });
});

describe("Saved for later's 'add a day' tip", () => {
  const NOW = "2026-10-26T09:00:00.000Z";
  const base = (): AppState => ({ ...buildInitialState(new Date(2026, 9, 26, 9)), hasSeenOnboarding: true });

  it("the words", () => {
    expect(SAVED_DATE_TIP).toBe("Tip: add a day (“dentist Friday”) and it comes back then.");
  });

  it("shows with nothing saved with a day, and the tip never closed", () => {
    expect(showSavedDateTip(base())).toBe(true);
    const undated = parkTasks(base(), ["Call Mark"], NOW, undefined, { today: "2026-10-26" });
    expect(undated.parkedTasks[0].when).toBeUndefined();
    expect(showSavedDateTip(withSavedDateTip(undated))).toBe(true);
  });

  it("goes for good once a dated item is saved, also after that item has gone", () => {
    const dated = withSavedDateTip(parkTasks(base(), ["Dentist Friday"], NOW, undefined, { today: "2026-10-26" }));
    expect(dated.parkedTasks[0].when).toEqual({ date: "2026-10-30", kind: "on" });
    expect(dated.savedDateTipDone).toBe(true);
    expect(showSavedDateTip(dated)).toBe(false);
    const gone = withSavedDateTip({ ...dated, parkedTasks: [] });
    expect(showSavedDateTip(gone)).toBe(false);
  });

  it("goes for good once closed", () => {
    expect(showSavedDateTip({ ...base(), savedDateTipDone: true })).toBe(false);
  });

  it("withSavedDateTip changes nothing (same object) when there's nothing to mark", () => {
    const state = base();
    expect(withSavedDateTip(state)).toBe(state);
    const done = { ...state, savedDateTipDone: true };
    expect(withSavedDateTip(done)).toBe(done);
  });

  it("is saved and loaded: an older save has it not done; a done one stays done", () => {
    const { savedDateTipDone: _dropped, ...old } = base();
    expect(normalizeState(JSON.parse(JSON.stringify(old)))!.savedDateTipDone).toBe(false);
    const done = { ...base(), savedDateTipDone: true };
    expect(normalizeState(JSON.parse(JSON.stringify(done)))!.savedDateTipDone).toBe(true);
    expect(normalizeState(JSON.parse(JSON.stringify({ ...base(), savedDateTipDone: "yes" })))!.savedDateTipDone).toBe(false);
  });

  it("a new install starts with it not done", () => {
    expect(buildInitialState(new Date(2026, 9, 26)).savedDateTipDone).toBe(false);
  });
});
