// Nag mode's tone (1.4): nothing affectionate or intimate from any voice,
// Mom and Spouse as the classic nagging types, and a Drill sergeant who is
// sometimes rude about the recruit's effort at Firm and Relentless, never at
// Gentle. Built-in lines, the proxy's prompt and sanitiser, and the phone's
// own filter for an AI line saved before these rules.
import { describe, expect, it } from "vitest";

import {
  builtInNagLines,
  isAffectionateNagLine,
  NAG_DRILL_RUDE,
  NAG_LEVELS,
  NAG_PERSONAS,
  NAG_TEMPLATES,
  nagDrillGetsRude,
  nagPools,
  nagTaskIsSensitive,
  parseNagResponse,
  requestNagLines,
  type NagLine,
  type NagPersona,
} from "../lib/daily-tasks/nag";
import { NAG_DRILL_RUDE_NOTE, nagLevelRudeNote } from "../lib/daily-tasks/nag-copy";
import { applyAiNagLines, NAG_LEVEL_COUNTS, nagAiKey, nagPlanFromRecord, normalizeNagRecord, planNagDay, type NagDayRecord, type NagPlanContext } from "../lib/daily-tasks/nag-plan";
import { nagIntroSamples } from "../lib/daily-tasks/whats-new";
import { DEFAULT_NOTIFICATIONS, type NotificationConfig } from "../lib/daily-tasks/types";
import * as server from "../server/providers/nag-contract.mjs";

const pools = (persona: NagPersona) => {
  const t = NAG_TEMPLATES[persona];
  return { early: t.early, midGentle: t.mid.gentle, midFirm: t.mid.firm, lateGentle: t.late.gentle, lateFirm: t.late.firm, lateRelentless: t.late.relentless };
};
const allLines = (persona: NagPersona) => Object.values(pools(persona)).flat();

// Everything a loving relative might say, and everything that claims a shared life or a family history.
const AFFECTION =
  /\b(?:love|loves|loved|loving|adore\w*|fond\w*|hugs?|kiss\w*|cuddl\w*|snuggl\w*|sweetheart|sweetie|honey|hon|babe|baby|darling|dear|dearest|favou?rite|better half|other half|miss you|xo\w*|heart|biggest fan|thinking of you)\b/i;
const REAL_FAMILY =
  /\b(?:your (?:mother|mom|mum|dad|father|wife|husband)|i raised you|i taught you|carried you|wife|husband|marriage|married|wedding|anniversary|our (?:bed|home|house|kids|children)|housemate|bed|bedroom)\b/i;

describe("built-in lines: nothing affectionate, intimate or posing as family", () => {
  it("every voice still has 34 lines, in the same pools", () => {
    for (const persona of NAG_PERSONAS) {
      expect(Object.values(pools(persona)).map((pool) => pool.length), persona).toEqual([10, 5, 5, 4, 5, 5]);
      expect(new Set(allLines(persona)).size, persona).toBe(34);
    }
  });

  it("no line of any voice declares love or fondness, uses a pet name, or speaks as the user's real family", () => {
    for (const persona of NAG_PERSONAS) {
      for (const template of allLines(persona)) {
        expect(template, template).not.toMatch(AFFECTION);
        expect(template, template).not.toMatch(REAL_FAMILY);
        expect(isAffectionateNagLine(template), template).toBe(false);
        // The proxy's whole blocklist (the affection group included), with the voice's own allowance.
        expect(server.hitsNagBlocklist(template.replace("{task}", "it"), [], persona), template).toBe(false);
      }
    }
  });

  it("Mom, Spouse and Coach pass the full blocklist with no allowance: only the Drill sergeant has rude lines", () => {
    for (const persona of ["mom", "spouse", "coach"] as const) {
      for (const template of allLines(persona)) expect(server.hitsNagBlocklist(template.replace("{task}", "it")), template).toBe(false);
    }
  });

  it("Mom and Spouse are the nagging types: they repeat themselves, sigh and won't let it drop", () => {
    expect(NAG_TEMPLATES.mom.early).toContain("I'm not mad, I'm just asking. Did {task} happen yet?");
    expect(NAG_TEMPLATES.mom.late.relentless).toContain("Do I have to come over there about {task}?");
    expect(NAG_TEMPLATES.spouse.mid.firm).toContain("No, no, take your time with {task}. I'll wait. Loudly.");
    expect(NAG_TEMPLATES.spouse.late.relentless).toContain("Fine. Leave {task}. See if I bring it up again. I will.");
  });
});

describe("the Drill sergeant is sometimes rude, and never at Gentle", () => {
  const rude = (pool: readonly string[]) => pool.filter((line) => NAG_DRILL_RUDE.test(line));

  it("the rude lines are only in the firm and relentless pools: 3 of 5, 2 of 5 and 4 of 5", () => {
    const p = pools("drill");
    expect(rude(p.early)).toEqual([]);
    expect(rude(p.midGentle)).toEqual([]);
    expect(rude(p.lateGentle)).toEqual([]);
    expect(rude(p.midFirm)).toHaveLength(3);
    expect(rude(p.lateFirm)).toHaveLength(2);
    expect(rude(p.lateRelentless)).toHaveLength(4);
    // Each of those pools has a rude line that names the task and one that doesn't.
    for (const pool of [p.midFirm, p.lateFirm, p.lateRelentless]) {
      expect(rude(pool).some((line) => line.includes("{task}"))).toBe(true);
      expect(rude(pool).some((line) => !line.includes("{task}"))).toBe(true);
    }
  });

  it("no other voice has a rude line", () => {
    for (const persona of ["mom", "spouse", "coach"] as const) {
      expect(allLines(persona).filter((line) => /\b(?:maggot|worm|slacker|cupcake|pathetic|lazy|weak|sloppy|disgrace)\b/i.test(line)), persona).toEqual([]);
    }
  });

  it("a Gentle day never gets one, whatever the day, the count or the tasks", () => {
    for (const stage of ["early", "mid", "late"] as const) expect(rude(nagPools("drill", "gentle", stage).flat()), stage).toEqual([]);
    for (let day = 0; day < 200; day += 1) {
      for (const tasks of [[], [{ text: "Write the report" }]]) {
        for (const count of [4, 16]) {
          for (const line of builtInNagLines({ persona: "drill", level: "gentle", tasks, count, seed: `day-${day}` })) {
            expect(line.text, line.text).not.toMatch(NAG_DRILL_RUDE);
          }
        }
      }
    }
  });

  it("about one line in three of a Firm day and of a Relentless day is rude: some lines, never most of the day", () => {
    const share = (level: "firm" | "relentless", count: number) => {
      let lines = 0;
      let rudeLines = 0;
      let daysWithNone = 0;
      for (let day = 0; day < 400; day += 1) {
        const texts = builtInNagLines({ persona: "drill", level, tasks: [{ text: "Write the report" }], count, seed: `day-${day}` }).map((line) => line.text);
        const hits = texts.filter((text) => NAG_DRILL_RUDE.test(text)).length;
        lines += texts.length;
        rudeLines += hits;
        if (hits === 0) daysWithNone += 1;
        // Never the whole day, and never the opening third.
        expect(hits).toBeLessThan(texts.length / 2 + 1);
        expect(NAG_DRILL_RUDE.test(texts[0])).toBe(false);
      }
      return { share: rudeLines / lines, daysWithNone };
    };
    const firm = share("firm", 7);
    expect(firm.share).toBeGreaterThan(0.2);
    expect(firm.share).toBeLessThan(0.35);
    expect(firm.daysWithNone).toBe(0);
    const relentless = share("relentless", 11);
    expect(relentless.share).toBeGreaterThan(0.28);
    expect(relentless.share).toBeLessThan(0.45);
    expect(relentless.daysWithNone).toBe(0);
  });

  it("over 2,000 days every Firm and Relentless day with an ordinary task has at least one rude line, and Gentle has none", () => {
    for (const level of NAG_LEVELS) {
      for (const tasks of [[{ text: "Write the report" }], [{ text: "Write the report" }, { text: "Fix the bike" }, { text: "Call Sam" }]]) {
        for (let day = 0; day < 2000; day += 1) {
          const lines = builtInNagLines({ persona: "drill", level, tasks, count: NAG_LEVEL_COUNTS[level], seed: `2026-10-12|salt-${day}` });
          const hits = lines.filter((line) => NAG_DRILL_RUDE.test(line.text)).length;
          expect(lines).toHaveLength(NAG_LEVEL_COUNTS[level]);
          expect(new Set(lines.map((line) => line.text)).size).toBe(lines.length);
          if (level === "gentle") expect(hits, `${level} ${day}`).toBe(0);
          else expect(hits, `${level} ${day}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("the rude lines are about the effort: none says what the recruit is", () => {
    expect(NAG_TEMPLATES.drill.late.relentless).toContain("Pathetic effort, recruit. I've seen snails file paperwork faster. NOW.");
    expect(NAG_TEMPLATES.drill.late.relentless).toContain("I've seen glaciers tick faster than you, recruit. {task}. MOVE.");
    expect(NAG_TEMPLATES.drill.mid.firm).toContain("My boots have more hustle than you, slacker. The list. MOVE.");
    for (const line of allLines("drill")) {
      expect(line, line).not.toMatch(/grandmother|a little bit you|\byou(?:'re| are) (?!still)/i);
      // Through the whole sanitiser, as the Drill sergeant.
      const text = line.replace("{task}", "the report");
      expect(server.cleanNagLine(text, { persona: "drill", ownTexts: ["the report"] }), line).toBe(text);
    }
  });

  it("the rude lines stay off worth, intelligence, body, gender, threats and swearing", () => {
    for (const line of allLines("drill")) {
      expect(line, line).not.toMatch(/\b(?:stupid|idiot|moron|dumb|worthless|useless|nobody|failure|loser|fat|ugly|princess|ladies|man up|girl|old|break you|kill|die|dead|hell|damn)\b/i);
    }
  });

  it("Settings and the intro sheet say so, for the Drill sergeant at Firm and Relentless only", () => {
    expect(NAG_DRILL_RUDE_NOTE).toBe("Drill sergeant gets rude at this level: it mocks your effort, not you.");
    for (const persona of NAG_PERSONAS) {
      for (const level of NAG_LEVELS) {
        const on = persona === "drill" && level !== "gentle";
        expect(nagDrillGetsRude(persona, level)).toBe(on);
        expect(nagLevelRudeNote(persona, level)).toBe(on ? NAG_DRILL_RUDE_NOTE : null);
      }
    }
  });
});

describe("the proxy's prompt", () => {
  it("has the two new rules, word for word", () => {
    for (const rule of [
      "No declarations of love or affection and nothing romantic or intimate: never 'I love you', 'love you', 'I adore you', 'with love', hugs, kisses or hearts, and no pet names (honey, sweetheart, sweetie, babe, baby, darling, dear, my love).",
      "The persona is a comic type, not a stand-in for the user's real mother, father, partner or anyone they know. Never write as if you were that person.",
    ]) {
      expect(server.NAG_SAFETY_RULES).toContain(rule);
      expect(server.NAG_SYSTEM_PROMPT).toContain(`- ${rule}`);
    }
  });

  it("says who may insult and what stays off limits for everyone", () => {
    expect(server.NAG_SAFETY_RULES[0]).toBe(
      "Annoying on purpose. For Mom, Dad, Partner and Coach the joke is the nagging, never the person. The Drill sergeant alone may insult the recruit's effort, speed and excuses in comic boot-camp style (maggot, slacker, 'is that all you've got'), within every other rule below.",
    );
    expect(server.NAG_SAFETY_RULES).toContain(
      "Never insult or judge the person's worth, intelligence, body, weight, health, mental health, family, relationships, money or job.",
    );
    expect(server.NAG_SAFETY_RULES).toContain(
      "If a task looks sensitive (health, grief, money, relationships, work trouble), keep that line plain and kind: a simple reminder, no jokes about the subject. This applies to the Drill sergeant too: no insult on that line.",
    );
  });

  it("gives the voices as nagging types, with no affection, and the Drill sergeant's allowance", () => {
    const prompt = (persona: string) => server.buildNagPrompt({ persona, level: "firm", tasks: [{ text: "Write the report" }], count: 6 });
    expect(prompt("mom")).toContain("Persona: Mom. The classic nagging-mother type: keeps bringing it up, repeats herself, sighs");
    expect(prompt("mom")).toContain("No pet names and no 'I love you'.");
    expect(prompt("spouse")).toContain("Persona: Partner. The classic nagging other-half type: exasperated, long-suffering, counts how many times it has come up");
    expect(prompt("spouse")).toContain("Never romantic or affectionate, no pet names, no 'I love you'.");
    expect(prompt("drill")).toContain("sometimes insults the recruit's effort, speed and excuses in classic boot-camp style: maggot, worm, slacker");
    expect(prompt("drill")).toContain("Persona: Drill sergeant. Loud, barky and sometimes rude about the recruit's effort.");
    expect(prompt("drill")).toContain("never at who the recruit is: 'pathetic effort', never 'you are pathetic'.");
    expect(prompt("coach")).not.toMatch(/maggot|insults/);
  });

  it("offers no heart among the emoji", () => {
    expect(server.NAG_EMOJI_ALLOWED).not.toContain("❤");
    expect(server.NAG_EMOJI_ALLOWED).not.toContain("\u{1F49B}");
    expect(server.NAG_SYSTEM_PROMPT).not.toMatch(/[❤\u{1F493}-\u{1F49F}]/u);
  });
});

describe("the proxy's sanitiser: affection", () => {
  const TASKS = ["Write the report", "Call the dentist"];
  const clean = (text: string, persona = "spouse", ownTexts = TASKS) => server.cleanNagLine(text, { persona, ownTexts });

  it.each([
    "I love you. The report is still open.",
    "Love you 😉",
    "Hi honey, quick reminder.",
    "Big hug, the list is open.",
    "It's your mother. The list is open.",
    "Your wife is asking about the report.",
    "Luv ya. The list is open.",
    "ILY, and the list is open.",
    "The list is open, my love.",
    "Sweet dreams once the list is done.",
    "A snuggle once the report is done.",
    "Your hubby says the list is open.",
    "Wifey reminder: the report.",
    "Your husband noticed the list.",
    "Your mom would tick this one.",
    "Your dad says the list is open.",
    "This is your wife. The report.",
    "Hello dear, the list is open.",
    "Kisses, and the report is open.",
    "With love: the report.",
    "I adore you and the list is open.",
    "Miss you. The list is open.",
    "Babe. The report.",
    "The list, darling.",
    "Xoxo, the list.",
    "Our anniversary can wait, the report can't.",
    "It's me, your mother.",
    "This is your wife.",
    "It is me, your husband. The list.",
    "I love you.",
    "We love you. The list.",
    "Love ya, the list is open.",
    "I would love you to know I care.",
    "With love to you and the list.",
    "Sending love to the list.",
    "Oh, dear. The list, dear.",
    "My baby, take baby steps.",
  ])("drops %j for every voice", (text) => {
    for (const persona of NAG_PERSONAS) expect(clean(text, persona), persona).toBe("");
  });

  it("a heart comes out of the line and the line stays; a heart on an affectionate line goes with it", () => {
    expect(clean("The report is still open ❤️")).toBe("The report is still open");
    expect(clean("The report is still open \u{1F495}", "mom")).toBe("The report is still open");
    expect(clean("Love you ❤️")).toBe("");
  });

  it.each([
    "A lovely day to tick one thing.",
    "Gloves on. The report is open.",
    "Honeydew can wait. The report can't.",
    "No dearth of time. One tick.",
    "Babysit the list for ten minutes.",
    "Honest question: the report?",
    "Father would be proud.",
    "Mom types notice an open list.",
  ])("keeps %j: whole words only", (text) => {
    expect(clean(text)).toBe(text);
  });

  it.each([
    "This is me asking nicely about the bike.",
    "It's me again. Still asking.",
    "This is me blowing the whistle. Go.",
    "It's me, the list. Still open.",
    "I'd love to see one tick.",
    "I would love it if one got ticked.",
    "You'll love how a tick feels.",
    "You'd love the look of an empty list.",
    "Would love that report done.",
    "Oh dear. The list is still open.",
    "Dear me, the report again.",
    "Baby steps, champ.",
    "One baby step on the report.",
  ])("keeps %j for every voice: not posing as anyone, and a figure of speech is not affection", (text) => {
    for (const persona of NAG_PERSONAS) expect(clean(text, persona), persona).toBe(text);
  });

  it("a task with 'love' in it never excuses a declaration", () => {
    const own = ["Buy a gift for my love"];
    for (const text of ["I love you. The gift is still open.", "Love you! Now the gift.", "We adore you, and the gift is open.", "The gift. Love ya.", "I LOVE U. The gift."]) {
      for (const persona of NAG_PERSONAS) expect(clean(text, persona, own), text).toBe("");
      expect(isAffectionateNagLine(text, own), text).toBe(true);
    }
    expect(clean("The gift for your love is still open.", "spouse", own)).toBe("The gift for your love is still open.");
    expect(isAffectionateNagLine("The gift for your love is still open.", own)).toBe(false);
  });

  it("the user's own task words are still excused", () => {
    expect(clean("“Buy a gift for my love” is still open. I checked.", "spouse", ["Buy a gift for my love"])).toBe("“Buy a gift for my love” is still open. I checked.");
    expect(clean("The gift for your love is still on the list.", "spouse", ["Buy a gift for my love"])).toBe("The gift for your love is still on the list.");
    expect(clean("Feed the baby. Still open.", "mom", ["Feed the baby"])).toBe("Feed the baby. Still open.");
    expect(clean("Did the baby get fed? Only asking.", "mom", ["Feed the baby"])).toBe("Did the baby get fed? Only asking.");
    expect(clean("Email Dear Abby is still open.", "mom", ["Email Dear Abby"])).toBe("Email Dear Abby is still open.");
    expect(clean("Have you called your mom yet? Only asking.", "mom", ["Call mom"])).toBe("Have you called your mom yet? Only asking.");
    expect(clean("The wife's birthday card is still open.", "coach", ["Buy a card for my wife"])).toBe("The wife's birthday card is still open.");
    // Without the task, the same lines are dropped.
    expect(clean("Feed the baby. Still open.", "mom")).toBe("");
    expect(clean("Have you called your mom yet? Only asking.", "mom")).toBe("");
    // And a task never lets the voice say more than the task's own words, or pose as the person.
    expect(clean("Feed the baby, honey.", "mom", ["Feed the baby"])).toBe("");
    expect(clean("I love you. Buy a gift for my love.", "spouse", ["Buy a gift for my wife"])).toBe("");
    expect(clean("It's your mom. Call me back about the list.", "mom", ["Call mom"])).toBe("");
    expect(clean("This is your wife. The card.", "spouse", ["Buy a card for my wife"])).toBe("");
  });

  it("harm said to the person is checked as before, own words or not", () => {
    for (const text of ["I'll kill you if it stays open.", "I hate you a little.", "Go hurt yourself.", "I will end you, recruit."]) {
      for (const persona of NAG_PERSONAS) expect(clean(text, persona, ["Kill the weeds", "Hate mail", "End the day"]), text).toBe("");
    }
    expect(clean("Kill the weeds already.", "drill", ["Kill the weeds"])).toBe("Kill the weeds already.");
  });

  it("the route's answer loses those lines and keeps the rest", () => {
    const payload = { persona: "spouse", level: "firm", tasks: TASKS.map((text) => ({ text })), count: 6 };
    const lines = [
      "I love you. The report is still open.",
      "Reminder number several: the report.",
      "Hi honey, quick reminder.",
      "The dentist. I'm mentioning it again.",
      "A lovely day to tick one thing.",
      "Still open ❤️",
    ].map((text, index) => ({ step: index + 1, taskIndex: null, text }));
    expect(server.sanitizeNagLines({ lines }, payload).lines.map((line: NagLine) => line.text)).toEqual([
      "Reminder number several: the report.",
      "The dentist. I'm mentioning it again.",
      "A lovely day to tick one thing.",
      "Still open",
    ]);
  });
});

describe("the proxy's sanitiser: who may be rude", () => {
  const clean = (text: string, persona: string, ownTexts: string[] = []) => server.cleanNagLine(text, { persona, ownTexts });

  it.each([
    "Is that the best you've got, maggot? The list is STILL open.",
    "MOVE, you lazy worm. The list.",
    "Pathetic effort, recruit. Again.",
    "Slacker! The list is open.",
    "That excuse is a disgrace to this list, recruit.",
    "Sorry excuse for a recruit. TICK SOMETHING.",
    "Lazy marching today, recruit. Fix it.",
    "Sorry excuse for a march, recruit.",
    "You call that pathetic effort a march, slacker?",
  ])("%j passes for the Drill sergeant and is dropped for every other voice", (text) => {
    expect(clean(text, "drill")).toBe(text);
    for (const persona of ["mom", "spouse", "coach"]) expect(clean(text, persona), persona).toBe("");
    // With no voice given the whole list applies.
    expect(server.hitsNagBlocklist(text)).toBe(true);
    expect(server.hitsNagBlocklist(text, [], "drill")).toBe(false);
  });

  it.each([
    "You are worthless, recruit.",
    "Stupid recruit. The list.",
    "You idiot. MOVE.",
    "Useless. The list is open.",
    "You're a failure, recruit.",
    "Loser. TICK SOMETHING.",
    "You are pathetic, recruit.",
    "You're a disgrace, recruit.",
    "Move it, fatso.",
    "Man up, recruit.",
    "You tick like a girl, recruit.",
    "Move it, princess.",
    "Ladies, the list is open.",
    "I will break you, maggot. Or else.",
    "I'll kill you, maggot.",
    "Damn it, recruit. The list.",
    "Move your ass, recruit.",
    "You never finish, maggot.",
    "You'll get fired, slacker.",
    "Crazy lazy recruit.",
    "I love you, maggot.",
    "You are lazy and you know it.",
    "You're lazy today, recruit. Fix it.",
    "You sorry excuse for a human being.",
    "Pathetic little worm.",
    "Worthless maggot. MOVE.",
    "You're a waste of oxygen, maggot.",
    "You are nothing, recruit.",
    "You're weak, recruit.",
    "You'll never amount to anything, slacker.",
    "What is wrong with you, recruit?",
    "You make me sick, recruit.",
    "You're as thick as a plank, recruit.",
    "You lazy lump of lard.",
    "I will make you regret this, maggot.",
    "Move or I'll make you move, worm.",
    "Nobody would miss a worm like you.",
    "No one would notice you gone, slacker.",
    "You are a weakling, recruit.",
    "You're a sorry excuse, recruit.",
    "You are so pathetic, recruit.",
    "You're a joke, recruit.",
    "Soft in the head, recruit.",
    "Sorry little maggot. The list.",
  ])("%j is dropped for the Drill sergeant too", (text) => {
    for (const persona of NAG_PERSONAS) expect(clean(text, persona), persona).toBe("");
  });

  it("the allowance is exactly the effort words", () => {
    expect(server.NAG_DRILL_ALLOWED).toEqual(["pathetic", "lazy", "laziness", "slackers?", "disgrace\\w*", "maggots?", "worms?", "weaklings?", "sorry excuse"]);
    for (const word of ["stupid", "idiot", "dumb", "worthless", "useless", "loser", "failure", "fat", "ugly", "crazy", "kill", "hell", "love", "honey"]) {
      expect(server.NAG_DRILL_BLOCKLIST_PATTERN.test(word), word).toBe(true);
    }
    for (const word of ["lazy", "maggot", "worms", "slacker", "pathetic", "disgraceful"]) {
      expect(server.NAG_DRILL_BLOCKLIST_PATTERN.test(word), word).toBe(false);
      expect(server.NAG_BLOCKLIST_PATTERN.test(word), word).toBe(true);
    }
  });

  it("'you are' is only ever followed by a boot-camp name: the allowance is for the effort, not the person", () => {
    expect(server.NAG_DRILL_NAMES).toEqual(["maggots?", "worms?", "slackers?"]);
    for (const text of ["You're a slacker, recruit. MOVE.", "You are a maggot until that list is clear.", "MOVE, you lazy worm. The list."]) {
      expect(clean(text, "drill"), text).toBe(text);
    }
    for (const word of ["lazy", "pathetic", "a disgrace", "disgraceful", "a weakling", "a sorry excuse", "so lazy", "stupid", "useless"]) {
      expect(clean(`You are ${word}, recruit.`, "drill"), word).toBe("");
      expect(clean(`You're ${word}, recruit.`, "drill"), word).toBe("");
    }
  });
});

describe("the phone's own filter for affectionate AI lines", () => {
  it.each([
    "I love you. The report is still open.",
    "Love you 😉",
    "Love ya. The list.",
    "Hi honey, quick reminder.",
    "Big hug, the list is open.",
    "Hugs. And the list.",
    "With love, the list is still open.",
    "I adore you. The list is still open.",
    "Sweetheart, the report.",
    "The list is open, sweetie.",
    "Babe. The report.",
    "Darling. Dearest. The list.",
    "A kiss when it's done.",
    "Still open ❤️",
    "Still open ❤",
    "Still open \u{1F49B}",
    "Still open \u{1F618}",
    "Still open \u{1F970}",
    "I LOVE YOU. THE REPORT.",
    "I’m here, my love.",
    "The list is open, love.",
    "Thanks, love!",
    "Tick one for me, love",
    "Still open, love?",
    "Yes, dear. The list.",
    "Dear, the list is still open.",
    "The report. Much love.",
    "Lots of love, and the list.",
    "All my love. The list.",
    "We love you. The list.",
    "With love to you and the list.",
    "Still open \u{1F917}",
    "Still open \u{1F5A4}",
  ])("catches %j", (text) => {
    expect(isAffectionateNagLine(text)).toBe(true);
  });

  it.each([
    "A lovely day to tick one thing.",
    "Gloves on. The report is open.",
    "Honeydew can wait.",
    "I'm not mad, I'm just asking. Again.",
    "Still open \u{1F642}",
    "Still open ☕",
    "You'd love to tick this, I can tell.",
    "Hugely important: the report.",
    "Is that the best you've got, maggot?",
    "I'd love to see one tick.",
    "I love the look of a ticked list.",
    "You'll love how a tick feels.",
    "Oh dear, the list is still open.",
    "Dear me, the report again.",
    "Baby steps, champ.",
    "Hon är klar. Listan är öppen.",
    "Dearth of ticks today.",
    "Gloves. The report.",
    "For the love of lists, tick one.",
  ])("passes %j", (text) => {
    expect(isAffectionateNagLine(text)).toBe(false);
  });

  it("the task's own words are excused, and nothing more", () => {
    expect(isAffectionateNagLine("“Buy a gift for my love” is still open.", ["Buy a gift for my love"])).toBe(false);
    expect(isAffectionateNagLine("That gift for your love is still open.", ["Buy a gift for my love"])).toBe(false);
    expect(isAffectionateNagLine("Did you buy honey yet? Only asking.", ["Buy honey"])).toBe(false);
    expect(isAffectionateNagLine("Did you buy honey yet, sweetheart?", ["Buy honey"])).toBe(true);
    expect(isAffectionateNagLine("Did you buy honey yet? Only asking.", ["Write the report"])).toBe(true);
    expect(isAffectionateNagLine("Buy honey ❤️", ["Buy honey ❤️"])).toBe(true);
    expect(isAffectionateNagLine("Don't forget the gift for your love.", ["Buy a gift for my love"])).toBe(false);
    expect(isAffectionateNagLine("Don't forget the gift, love.", ["Buy a gift"])).toBe(true);
    expect(isAffectionateNagLine("The baby. Baby steps.", ["Feed the baby"])).toBe(false);
  });

  it("parseNagResponse drops such a line and keeps the rest, renumbered", () => {
    const data = {
      lines: [
        { step: 1, taskIndex: 0, text: "“Write the report”. I'm mentioning it." },
        { step: 2, taskIndex: null, text: "I love you. The list is still open." },
        { step: 3, taskIndex: null, text: "Reminder number several." },
        { step: 4, taskIndex: 0, text: "Hi sweetie. The report." },
        { step: 5, taskIndex: null, text: "Still open ❤️" },
        { step: 6, taskIndex: 1, text: "Buy honey. Still open." },
      ],
    };
    expect(parseNagResponse(data, { taskCount: 2, count: 6, ownTexts: ["Write the report", "Buy honey"] })).toEqual([
      { step: 1, taskIndex: 0, text: "“Write the report”. I'm mentioning it." },
      { step: 2, taskIndex: null, text: "Reminder number several." },
      { step: 3, taskIndex: 1, text: "Buy honey. Still open." },
    ]);
    // Without the tasks' words nothing is excused.
    expect(parseNagResponse(data, { taskCount: 2, count: 6 }).map((line) => line.text)).toEqual(["“Write the report”. I'm mentioning it.", "Reminder number several."]);
  });

  it("requestNagLines excuses the tasks it sent, and an answer that is mostly affection counts as failed", async () => {
    const answer = (texts: string[]) =>
      (async () => new Response(JSON.stringify({ lines: texts.map((text, index) => ({ step: index + 1, taskIndex: text.includes("Buy honey") ? 0 : null, text })) }), { status: 200 })) as unknown as typeof fetch;
    const ask = (texts: string[]) =>
      requestNagLines({ persona: "spouse", level: "firm", tasks: [{ text: "Buy honey" }], count: 4, planUrl: "https://proxy.test/api/momentum/plan", fetchImpl: answer(texts) });
    expect((await ask(["Buy honey. Still.", "Love you. The list.", "Reminder two.", "Reminder three."])).lines.map((line) => line.text)).toEqual([
      "Buy honey. Still.",
      "Reminder two.",
      "Reminder three.",
    ]);
    await expect(ask(["I love you.", "Hugs.", "Reminder two.", "Reminder three."])).rejects.toThrow();
  });
});

describe("the day's plan never says an affectionate AI line", () => {
  const DAY = "2026-10-12";
  const at = (hour: number, minute = 0) => new Date(2026, 9, 12, hour, minute);
  const NAG_ON: NotificationConfig = { ...DEFAULT_NOTIFICATIONS, style: "nag", nagConfirmed: true, nagPersona: "spouse" };
  const TASKS = [
    { id: "t0", text: "Call the dentist", done: false },
    { id: "t1", text: "Write the report", done: false },
  ];
  const OPEN = TASKS.map(({ id, text }) => ({ id, text }));
  const context = (overrides: Partial<NagPlanContext> = {}): NagPlanContext => ({ now: at(7), today: DAY, settings: NAG_ON, permissionState: "granted", tasks: TASKS, plus: true, ...overrides });
  const planned = () => planNagDay({ previous: null, now: at(7), dayKey: DAY, settings: NAG_ON, open: OPEN, salt: "salt-a" });
  const ai = (total: number, bad: Record<number, string>): NagLine[] =>
    Array.from({ length: total }, (_unused, index) => ({ step: index + 1, taskIndex: null, text: bad[index + 1] ?? `Reminder number ${index + 1}. The list.` }));
  const builtIn = new Set(NAG_PERSONAS.flatMap(allLines).map((template) => template.split("{task}")[0]));
  const isBuiltIn = (text: string) => [...builtIn].some((start) => text.startsWith(start));

  it("a fresh batch with one: that nag keeps its built-in line, the others take the AI's", () => {
    const record = planned();
    expect(record.total).toBe(7);
    const next = applyAiNagLines(record, ai(7, { 3: "I love you. The list is still open.", 6: "Big hug. Still open ❤️" }), OPEN, at(7));
    expect(next.slots.map((slot) => slot.text)).toEqual([
      "Reminder number 1. The list.",
      "Reminder number 2. The list.",
      record.slots[2].text,
      "Reminder number 4. The list.",
      "Reminder number 5. The list.",
      record.slots[5].text,
      "Reminder number 7. The list.",
    ]);
    expect(isBuiltIn(next.slots[2].text)).toBe(true);
    expect(next.slots[2].taskId).toBe(record.slots[2].taskId);
    const said = nagPlanFromRecord(next, context()).map((item) => item.body);
    expect(said).toHaveLength(7);
    for (const body of said) expect(isAffectionateNagLine(body, OPEN.map((task) => task.text)), body).toBe(false);
  });

  // What a phone may hold from before the rule: the AI's lines saved in the
  // record, and already written into the slots still to come.
  const stored = (): NagDayRecord => {
    const record = planned();
    const lines = ai(7, { 2: "Hi honey. The list is still open.", 4: "I love you. The list is still open.", 7: "Love of my life. The list. Please ❤️" });
    const saved = {
      ...record,
      lines,
      lineTasks: OPEN.map((task) => task.id),
      source: "ai",
      aiCalls: 1,
      aiFor: nagAiKey("spouse", "firm", OPEN),
      slots: record.slots.map((slot, index) => ({ ...slot, text: lines[index].text, taskId: null })),
    };
    // Through storage, as the app reads it.
    return normalizeNagRecord(JSON.parse(JSON.stringify(saved))) as NagDayRecord;
  };

  it("a stored record with such lines never produces one in the plan: those nags get a built-in line for their step", () => {
    const record = stored();
    expect(record.slots.map((slot) => slot.text).filter((text) => isAffectionateNagLine(text))).toHaveLength(3);
    const items = nagPlanFromRecord(record, context());
    expect(items).toHaveLength(7);
    expect(items.map((item) => item.id)).toEqual(record.slots.map((slot) => slot.id));
    items.forEach((item, index) => {
      expect(item.body, item.body).not.toMatch(/love|honey|❤/i);
      if ([1, 3, 6].includes(index)) expect(isBuiltIn(item.body), item.body).toBe(true);
      else expect(item.body).toBe(`Reminder number ${index + 1}. The list.`);
    });
    // The replacements are spouse lines for the same point of the day: the last is not an opening line.
    expect(NAG_TEMPLATES.spouse.early.some((template) => items[6].body.startsWith(template.split("{task}")[0]) && !template.startsWith("{task}"))).toBe(false);
    expect(new Set(items.map((item) => item.body)).size).toBe(7);
  });

  it("nor when the day is planned again from that record (a task ticked, the same voice and level)", () => {
    const record = stored();
    const again = planNagDay({ previous: record, now: at(7, 30), dayKey: DAY, settings: NAG_ON, open: OPEN, salt: "salt-b" });
    expect(again.source).toBe("ai");
    for (const slot of again.slots) expect(isAffectionateNagLine(slot.text), slot.text).toBe(false);
    expect(again.slots.filter((slot) => slot.text.startsWith("Reminder number"))).toHaveLength(4);
    for (const item of nagPlanFromRecord(again, context({ now: at(7, 30) }))) expect(item.body).not.toMatch(/love|honey|❤/i);
  });

  it("a stored line that only repeats the user's task is kept", () => {
    const tasks = [{ id: "t0", text: "Buy honey", done: false }];
    const open = [{ id: "t0", text: "Buy honey" }];
    const record = planNagDay({ previous: null, now: at(7), dayKey: DAY, settings: NAG_ON, open, salt: "salt-a" });
    const lines = ai(7, { 2: "Buy honey. I'm mentioning it again." });
    const next = applyAiNagLines(record, lines, open, at(7));
    expect(next.slots[1].text).toBe("Buy honey. I'm mentioning it again.");
    expect(nagPlanFromRecord(next, context({ tasks })).map((item) => item.body)).toContain("Buy honey. I'm mentioning it again.");
  });
});

describe("a sensitive task is never named by a built-in line, and the Drill sergeant is not rude that day", () => {
  const SENSITIVE = ["Dad's funeral arrangements", "Call the oncologist", "Pay overdue rent"];
  // The words that would give each one away in a line.
  const WORDS = /funeral|arrangements|dad['\u2019]s|oncolog|overdue|\brent\b/i;
  const ORDINARY = "Fix the bike";

  it.each([
    "Dad's funeral arrangements", "Call the oncologist", "Pay overdue rent", "Book the memorial", "Write Sam's obituary", "Go to the wake", "Visit the hospice",
    "Hospital at 3", "Oncology follow-up", "Cancer screening", "Chemo session", "Chemotherapy", "Biopsy results", "Book surgery", "Email the surgeon",
    "Call the doctor", "See Dr. Patel", "Clinic visit", "Therapy at 5", "Find a therapist", "Psychiatrist appointment", "Counselling session", "Counselor call",
    "Rehab intake", "Read the diagnosis", "Diagnostic test", "Refill medication", "Pick up meds", "Renew prescription", "Grief group", "Grieving card for Ann",
    "Send condolences", "Sort out what to do since mum died", "Order the death certificate", "Call the family, grandpa passed away", "Divorce papers",
    "Custody hearing", "Call the lawyer", "Email my attorney", "Court date", "Eviction notice", "We got evicted: find boxes", "Clear the debt", "Loan application",
    "Mortgage call", "Bankruptcy forms", "Tell Sam I got fired", "Layoff paperwork", "Laid off: update CV", "Redundancy meeting", "Resign from the board",
    "Resignation letter", "Take Rex to the vet", "Miscarriage follow-up", "Pregnancy test", "Settle the estate", "Probate forms", "File tax return", "Do my taxes",
    "Reply to the IRS", "Pay the gas bill", "Sort the bills", "Chase the payment", "Insurance claim", "FUNERAL flowers", "Dad\u2019s funeral arrangements",
  ])("%j is sensitive", (text) => {
    expect(nagTaskIsSensitive(text)).toBe(true);
  });

  it.each([
    "Write the report", "Fix the bike", "Call Sam", "Buy milk", "Awaken the sourdough", "Rental car pickup is done, wash it", "Different plan", "Courtesy call to Ann",
    "Billboard design", "Taxi to the station", "Drive to the airport", "Veteran's day card", "Parent evening", "I will finish the deck", "Read Good Will Hunting notes",
    "Doctorate reading", "Paymaster general essay", "Deathly Hallows chapter 3", "Rehabilitate the fern", "",
  ])("%j is not", (text) => {
    expect(nagTaskIsSensitive(text)).toBe(false);
  });

  it("alone: every voice and level, over many days, the full count with no repeats, no name and no rude line", () => {
    for (const task of SENSITIVE) {
      for (const persona of NAG_PERSONAS) {
        for (const level of NAG_LEVELS) {
          for (let day = 0; day < 150; day += 1) {
            const lines = builtInNagLines({ persona, level, tasks: [{ text: task }], count: NAG_LEVEL_COUNTS[level], seed: `2026-10-${day}|salt` });
            const label = `${task} ${persona} ${level} ${day}`;
            expect(lines, label).toHaveLength(NAG_LEVEL_COUNTS[level]);
            expect(new Set(lines.map((line) => line.text)).size, label).toBe(lines.length);
            for (const line of lines) {
              expect(line.taskIndex, label).toBeNull();
              expect(line.text, label).not.toMatch(WORDS);
              expect(line.text, label).not.toContain("\u201C");
              if (persona === "drill") expect(line.text, label).not.toMatch(NAG_DRILL_RUDE);
            }
            // The same lines as a day with names hidden and a sensitive task open.
            expect(lines).toEqual(builtInNagLines({ persona, level, tasks: [], count: NAG_LEVEL_COUNTS[level], seed: `2026-10-${day}|salt`, sensitiveDay: true }));
          }
        }
      }
    }
  });

  it("mixed with an ordinary task, in either order: only the ordinary one is named, and the Drill sergeant is still not rude", () => {
    for (const task of SENSITIVE) {
      for (const tasks of [[{ text: task }, { text: ORDINARY }], [{ text: ORDINARY }, { text: task }], [{ text: SENSITIVE[0] }, { text: ORDINARY }, { text: task }]]) {
        const ordinary = tasks.findIndex((item) => item.text === ORDINARY);
        for (const persona of NAG_PERSONAS) {
          for (const level of NAG_LEVELS) {
            for (let day = 0; day < 150; day += 1) {
              const lines = builtInNagLines({ persona, level, tasks, count: NAG_LEVEL_COUNTS[level], seed: `2026-10-${day}|salt` });
              const label = `${task} ${persona} ${level} ${day}`;
              expect(lines, label).toHaveLength(NAG_LEVEL_COUNTS[level]);
              expect(new Set(lines.map((line) => line.text)).size, label).toBe(lines.length);
              expect(lines.some((line) => line.taskIndex === ordinary), label).toBe(true);
              for (const line of lines) {
                expect([null, ordinary], label).toContain(line.taskIndex);
                expect(line.text, label).not.toMatch(WORDS);
                if (line.taskIndex !== null) expect(line.text, label).toContain("\u201CFix the bike\u201D");
                if (persona === "drill") expect(line.text, label).not.toMatch(NAG_DRILL_RUDE);
              }
            }
          }
        }
      }
    }
  });

  it("the lines that used to come out are gone", () => {
    for (let day = 0; day < 300; day += 1) {
      for (const persona of ["drill", "spouse"] as const) {
        for (const line of builtInNagLines({ persona, level: "relentless", tasks: [{ text: "Dad's funeral arrangements" }], count: 16, seed: day })) {
          expect(line.text).not.toMatch(/funeral|MAGGOT|ballad about \u201C/);
        }
      }
    }
  });

  it("the Settings sample and the Meet Nag mode preview don't name one either (the same generator)", () => {
    for (const task of SENSITIVE) {
      for (const persona of NAG_PERSONAS) {
        for (const level of NAG_LEVELS) {
          // Settings: builtInNagLines with the next open task, 16 lines, seed "sample".
          const sample = builtInNagLines({ persona, level, tasks: [{ text: task }], count: 16, seed: "sample" }).map((line) => line.text);
          const preview = nagIntroSamples({ persona, level, taskText: task });
          expect(preview).toHaveLength(NAG_LEVEL_COUNTS[level]);
          for (const text of [...sample, ...preview]) {
            expect(text, text).not.toMatch(WORDS);
            if (persona === "drill") expect(text, text).not.toMatch(NAG_DRILL_RUDE);
          }
        }
      }
    }
  });

  describe("in the day's plan", () => {
    const DAY = "2026-10-12";
    const at = (hour: number, minute = 0) => new Date(2026, 9, 12, hour, minute);
    const settings = (overrides: Partial<NotificationConfig> = {}): NotificationConfig => ({ ...DEFAULT_NOTIFICATIONS, style: "nag", nagConfirmed: true, nagPersona: "drill", nagLevel: "relentless", ...overrides });
    const FUNERAL = { id: "t0", text: "Dad's funeral arrangements", done: false };
    const BIKE = { id: "t1", text: "Fix the bike", done: false };
    const REPORT = { id: "t2", text: "Write the report", done: false };
    const openOf = (tasks: { id: string; text: string; done: boolean }[]) => tasks.filter((task) => !task.done).map(({ id, text }) => ({ id, text }));
    const context = (tasks: typeof FUNERAL[], overrides: Partial<NagPlanContext> = {}): NagPlanContext => ({ now: at(7), today: DAY, settings: settings(), permissionState: "granted", tasks, plus: true, ...overrides });
    const calm = (bodies: string[]) => {
      for (const body of bodies) {
        expect(body, body).not.toMatch(WORDS);
        expect(body, body).not.toMatch(NAG_DRILL_RUDE);
      }
      expect(new Set(bodies).size).toBe(bodies.length);
    };

    it("a planned day never names the sensitive task and has no rude line, names hidden or shown", () => {
      for (let seed = 0; seed < 60; seed += 1) {
        for (const tasks of [[FUNERAL], [FUNERAL, BIKE], [BIKE, FUNERAL]]) {
          for (const hideTaskNames of [false, true]) {
            const record = planNagDay({ previous: null, now: at(7), dayKey: DAY, settings: settings({ hideTaskNames }), open: openOf(tasks), salt: `s${seed}` });
            expect(record.slots).toHaveLength(11);
            calm(record.slots.map((slot) => slot.text));
            for (const slot of record.slots) expect(slot.taskId).not.toBe("t0");
            const items = nagPlanFromRecord(record, context(tasks, { settings: settings({ hideTaskNames }) }));
            expect(items).toHaveLength(11);
            calm(items.map((item) => item.body));
          }
        }
      }
    });

    it("a ticked task: its nags go to the open task that isn't sensitive, or to a general line, never to the sensitive one", () => {
      for (let seed = 0; seed < 60; seed += 1) {
        const record = planNagDay({ previous: null, now: at(7), dayKey: DAY, settings: settings(), open: openOf([FUNERAL, BIKE, REPORT]), salt: `s${seed}` });
        expect(record.slots.some((slot) => slot.taskId === "t1")).toBe(true);
        // The bike is ticked: the first open task is now the sensitive one.
        const tasks = [FUNERAL, { ...BIKE, done: true }, REPORT];
        const items = nagPlanFromRecord(record, context(tasks));
        expect(items.length).toBeGreaterThan(8);
        calm(items.map((item) => item.body));
        for (const item of items) {
          expect([undefined, "t2"]).toContain((item.data as { taskId?: string }).taskId);
          expect(item.body).not.toContain("Fix the bike");
        }
        // With only the sensitive task left, the replaced nags are general lines.
        const left = [FUNERAL, { ...BIKE, done: true }, { ...REPORT, done: true }];
        const general = nagPlanFromRecord(record, context(left));
        calm(general.map((item) => item.body));
        for (const item of general) {
          expect((item.data as { taskId?: string }).taskId).toBeUndefined();
          expect(item.body).not.toContain("\u201C");
        }
      }
    });

    it("a record planned before the rule (the task named, a rude line): those nags are replaced", () => {
      const record = planNagDay({ previous: null, now: at(7), dayKey: DAY, settings: settings(), open: openOf([FUNERAL, BIKE]), salt: "s1" });
      const old: NagDayRecord = {
        ...record,
        slots: record.slots.map((slot, index) =>
          index === 3
            ? { ...slot, text: "\u201CDad's funeral arrangements\u201D! DROP AND GIVE ME TEN MINUTES, MAGGOT!", taskId: "t0" }
            : index === 5
              ? { ...slot, text: "I've seen houseplants with more hustle. TICK SOMETHING, WORM.", taskId: null }
              : slot,
        ),
      };
      const items = nagPlanFromRecord(old, context([FUNERAL, BIKE]));
      expect(items).toHaveLength(11);
      calm(items.map((item) => item.body));
      expect(items.map((item) => item.id)).toEqual(record.slots.map((slot) => slot.id));
    });

    it("an affectionate stored AI line on such a day is replaced by a line that is neither rude nor about the sensitive task", () => {
      const tasks = [FUNERAL, BIKE];
      const record = planNagDay({ previous: null, now: at(7), dayKey: DAY, settings: settings(), open: openOf(tasks), salt: "s2" });
      const lines: NagLine[] = record.slots.map((_slot, index) => ({ step: index + 1, taskIndex: null, text: index % 2 ? `I love you. The list is still open, ${index}.` : `Reminder number ${index + 1}. The list.` }));
      const saved: NagDayRecord = {
        ...record,
        lines,
        lineTasks: ["t0", "t1"],
        source: "ai",
        aiCalls: 1,
        aiFor: nagAiKey("drill", "relentless", openOf(tasks)),
        slots: record.slots.map((slot, index) => ({ ...slot, text: lines[index].text, taskId: null })),
      };
      const items = nagPlanFromRecord(saved, context(tasks));
      expect(items.length).toBeGreaterThan(6);
      calm(items.map((item) => item.body));
      for (const item of items) expect(item.body).not.toMatch(/love/i);
    });

    it("names hidden after the day was planned, and shown again: still no name of the sensitive task and nothing rude", () => {
      for (let seed = 0; seed < 40; seed += 1) {
        const tasks = [FUNERAL, BIKE];
        const record = planNagDay({ previous: null, now: at(7), dayKey: DAY, settings: settings(), open: openOf(tasks), salt: `s${seed}` });
        const hidden = nagPlanFromRecord(record, context(tasks, { settings: settings({ hideTaskNames: true }) }));
        expect(hidden).toHaveLength(11);
        calm(hidden.map((item) => item.body));
        for (const item of hidden) expect(item.body).not.toContain("\u201C");
        // What planNagDay then writes is the same.
        const replanned = planNagDay({ previous: record, now: at(7), dayKey: DAY, settings: settings({ hideTaskNames: true }), open: openOf(tasks), salt: "x" });
        expect(replanned.slots.map((slot) => slot.text)).toEqual(hidden.map((item) => item.body));
        const shown = planNagDay({ previous: replanned, now: at(7), dayKey: DAY, settings: settings(), open: openOf(tasks), salt: "x" });
        calm(shown.slots.map((slot) => slot.text));
      }
    });

    it("an ordinary day is as it was: the Drill sergeant is rude and names the task", () => {
      const record = planNagDay({ previous: null, now: at(7), dayKey: DAY, settings: settings(), open: openOf([BIKE]), salt: "s1" });
      expect(record.slots.some((slot) => NAG_DRILL_RUDE.test(slot.text))).toBe(true);
      expect(record.slots.some((slot) => slot.taskId === "t1")).toBe(true);
    });
  });
});
