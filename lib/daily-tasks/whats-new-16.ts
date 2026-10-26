// "What's new" in 1.6 (and 1.5, which ships inside it): the cards and their
// words, and which cards show for whom. Pure, so it's unit-tested; the sheet
// is components/daily-tasks/whats-new-16-sheet.tsx and Today decides what
// each button does (app/(tabs)/index.tsx). Who sees the sheet at all is
// whatsNewDecision (whats-new.ts), under FEATURES_16_ID.

/** What a card's button does. Sent as whats_new_action's `action` (an id, never words). */
export type WhatsNew16Action = "how_to" | "write_lines" | "try_nag" | "try_reset" | "coach_memory";

export type WhatsNew16CardId = "save_later" | "own_lines" | "sunday_reset" | "coach_memory" | "nag_answer";

export interface WhatsNew16Card {
  id: WhatsNew16CardId;
  /** An Ionicons name. */
  icon: string;
  title: string;
  body: string;
  /** Shown as a small "Plus" tag next to the title (only without Plus). */
  plus: boolean;
  /** One example, shown as "line → filled in" (own lines only). */
  example?: { line: string; filled: string; spoken: string };
  button: { action: WhatsNew16Action; label: string; hint?: string } | null;
}

/** Plain, short, no em dashes. Quotes are curly, as elsewhere in the app. */
export const WHATS_NEW_16_COPY = {
  label: "New in 1.6",
  title: "What's new",
  gotIt: "Got it",
  plusTag: "Plus",
  saveLater: {
    title: "Save for later from anywhere",
    body: "Share from any app, or tell Siri “Save for later in Three Today”. Add a day (“dentist Friday”) and it comes back that day.",
    button: "Show me",
    hideButton: "Hide how",
    steps: [
      { icon: "share-outline", text: "In any app, tap Share, then Three Today." },
      { icon: "mic-outline", text: "Or say to Siri: “Save for later in Three Today”." },
      { icon: "apps-outline", text: "For a quick brain dump, add the Dump widget to your Home Screen." },
    ],
  },
  ownLines: {
    title: "Nag in your own words",
    body: "Write the lines you want to hear. {task} becomes the task's name.",
    example: {
      line: "“{task}. Now. I mean it.”",
      filled: "“Gym. Now. I mean it.”",
      spoken: "For example, {task}. Now. I mean it. becomes: Gym. Now. I mean it.",
    },
    write: "Write your lines",
    writeHint: "Opens your own lines in Settings",
    tryNag: "Try Nag mode",
    tryNagHint: "Shows what Nag mode does and how it sounds",
  },
  sundayReset: {
    title: "Sunday reset",
    body: "Two quiet minutes on Sunday evening: your week's wins, a dump for the week, and Monday's three.",
    tryIt: "Try it now",
    /** Without Plus the button opens the paywall, and says so (as the 1.4 sheet's "See Plus"). */
    seePlus: "See Plus",
    seePlusHint: "Shows what Plus includes",
  },
  coachMemory: {
    title: "Your coach remembers",
    body: "It learns what you finish and what keeps getting pushed, and plans with that in mind. You can see and clear it anytime.",
    button: "See what it remembers",
    hint: "Opens What your coach remembers in Settings",
  },
  nagAnswer: {
    title: "Answer a nag right away",
    body: "Long-press a nag to Snooze an hour or Mark it done. Nags now always fit the task they're about.",
  },
} as const;

/**
 * The cards, in order: Save for later, own nag lines, Sunday reset, coach
 * memory, then answering a nag (only with Nag mode on: it's about nags they
 * get). `nagOn`: the Nag style with Plus (a saved Nag style without Plus
 * behaves as Calm, so it's off here too).
 */
export function whatsNew16Cards({ nagOn, hasPlus }: { nagOn: boolean; hasPlus: boolean }): WhatsNew16Card[] {
  const c = WHATS_NEW_16_COPY;
  const cards: WhatsNew16Card[] = [
    {
      id: "save_later",
      icon: "bookmark-outline",
      title: c.saveLater.title,
      body: c.saveLater.body,
      plus: false,
      button: { action: "how_to", label: c.saveLater.button },
    },
    {
      id: "own_lines",
      icon: "create-outline",
      title: c.ownLines.title,
      body: c.ownLines.body,
      plus: !hasPlus,
      example: c.ownLines.example,
      button:
        nagOn && hasPlus
          ? { action: "write_lines", label: c.ownLines.write, hint: c.ownLines.writeHint }
          : { action: "try_nag", label: c.ownLines.tryNag, hint: c.ownLines.tryNagHint },
    },
    {
      id: "sunday_reset",
      icon: "sunny-outline",
      title: c.sundayReset.title,
      body: c.sundayReset.body,
      plus: !hasPlus,
      button: hasPlus
        ? { action: "try_reset", label: c.sundayReset.tryIt }
        : { action: "try_reset", label: c.sundayReset.seePlus, hint: c.sundayReset.seePlusHint },
    },
    {
      id: "coach_memory",
      icon: "bulb-outline",
      title: c.coachMemory.title,
      body: c.coachMemory.body,
      plus: false,
      button: { action: "coach_memory", label: c.coachMemory.button, hint: c.coachMemory.hint },
    },
  ];
  if (nagOn && hasPlus) {
    cards.push({
      id: "nag_answer",
      icon: "notifications-outline",
      title: c.nagAnswer.title,
      body: c.nagAnswer.body,
      plus: false,
      button: null,
    });
  }
  return cards;
}
