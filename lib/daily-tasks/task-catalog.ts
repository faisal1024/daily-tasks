import type {
  UserEnergy,
  UserGoal,
  UserProfile,
  UserTimeWindow,
  UserWorkStyle,
} from "./types";

export interface GoalMeta {
  label: string;
  description: string;
}

export interface CatalogTask {
  id: string;
  goal: UserGoal;
  text: string;
  energy: UserEnergy;
  timeWindow: UserTimeWindow;
  workStyle: UserWorkStyle;
}

const GOAL_META: Record<UserGoal, GoalMeta> = {
  health: {
    label: "Health",
    description: "Movement, meals, sleep, and small body-care wins.",
  },
  career: {
    label: "Career",
    description: "Deep work, follow-through, visibility, and planning.",
  },
  learning: {
    label: "Learning",
    description: "Reading, practice, study, and skill-building.",
  },
  relationships: {
    label: "Relationships",
    description: "Connection, gratitude, care, and repair.",
  },
  home: {
    label: "Home",
    description: "Tidying, maintenance, errands, and calmer spaces.",
  },
  finance: {
    label: "Finance",
    description: "Money clarity, bills, budgeting, and future planning.",
  },
  creativity: {
    label: "Creativity",
    description: "Making, drafting, editing, and sharing creative work.",
  },
  mindfulness: {
    label: "Mindfulness",
    description: "Reflection, presence, emotional reset, and intention.",
  },
};

const GOAL_SEEDS: Record<UserGoal, string[]> = {
  health: [
    "take a brisk walk",
    "prepare a protein-forward meal",
    "stretch your back and hips",
    "drink water before coffee",
    "plan tonight's wind-down",
    "do a short strength circuit",
    "book or attend a health appointment",
    "prep one healthy snack",
  ],
  career: [
    "finish one important work block",
    "send a clear follow-up",
    "clean up your task board",
    "prepare for one meeting",
    "document a decision",
    "review your weekly priorities",
    "ship one small improvement",
    "ask for feedback on one thing",
  ],
  learning: [
    "read one useful chapter",
    "practice a skill drill",
    "summarize what you learned",
    "watch one focused lesson",
    "make five flashcards",
    "teach the idea back in writing",
    "solve one practice problem",
    "bookmark three quality references",
  ],
  relationships: [
    "send a thoughtful check-in",
    "schedule time with someone important",
    "write a thank-you note",
    "listen without multitasking",
    "repair one small tension",
    "share a useful update",
    "celebrate someone's progress",
    "make plans for quality time",
  ],
  home: [
    "reset one visible surface",
    "clear a small clutter zone",
    "run one needed errand",
    "prep tomorrow's essentials",
    "handle one maintenance task",
    "sort a drawer or shelf",
    "make the kitchen easier to use",
    "set up a calm evening space",
  ],
  finance: [
    "review today's spending",
    "pay or schedule one bill",
    "move money toward savings",
    "cancel one unused expense",
    "check one account balance",
    "update your budget notes",
    "compare one planned purchase",
    "organize one receipt or record",
  ],
  creativity: [
    "draft one rough idea",
    "edit one small section",
    "collect three references",
    "make for twenty focused minutes",
    "share one work-in-progress",
    "organize your creative workspace",
    "capture ten raw ideas",
    "finish one tiny creative artifact",
  ],
  mindfulness: [
    "write a three-line reflection",
    "sit quietly for five minutes",
    "name what you are feeling",
    "set a clear intention",
    "take a screen-free reset",
    "notice one good thing",
    "breathe slowly before reacting",
    "close one open mental loop",
  ],
};

const ENERGY_PREFIX: Record<UserEnergy, string[]> = {
  low: ["gently", "with minimum friction", "in one easy pass", "without overthinking"],
  steady: ["with focus", "at a sustainable pace", "before switching contexts", "with a clear finish line"],
  high: ["with momentum", "as a challenge", "in a strong work sprint", "while your energy is up"],
};

const TIME_DETAIL: Record<UserTimeWindow, string[]> = {
  quick: ["for 5 minutes", "in under 10 minutes", "before your next break", "as the next tiny step"],
  medium: ["for 20 minutes", "before lunch or dinner", "in one focused session", "with a simple checklist"],
  deep: ["for 45 focused minutes", "with distractions off", "as today's main work block", "until a meaningful milestone"],
};

const STYLE_SUFFIX: Record<UserWorkStyle, string[]> = {
  gentle: ["and stop when it feels complete", "without making it perfect", "so the day feels lighter"],
  structured: ["and write down the next step", "with a clear done point", "then reset your workspace"],
  ambitious: ["and push it one step further", "so future-you has less to carry", "and make the result visible"],
};

const CONTEXTS = [
  "today",
  "before your next transition",
  "while it is still fresh",
  "before the day gets crowded",
  "as your first clean win",
  "after a short reset",
  "before checking feeds",
  "with your phone away",
  "before opening a new task",
  "as a promise to yourself",
];

const OUTCOMES = [
  "so you can see progress",
  "so the next step is obvious",
  "so it is easier to continue tomorrow",
  "so the work feels lighter",
  "so you build useful momentum",
  "so you protect your attention",
  "so you reduce one source of friction",
  "so you finish with less noise",
  "so you make the goal concrete",
  "so you have a real stopping point",
];

export const USER_GOALS = Object.keys(GOAL_META) as UserGoal[];
export const USER_GOAL_META = GOAL_META;
export const TASK_CATALOG_SIZE = 10_000;

function pick<T>(items: T[], index: number): T {
  return items[index % items.length] as T;
}

export function buildTaskCatalog(): CatalogTask[] {
  const tasks: CatalogTask[] = [];
  const energies: UserEnergy[] = ["low", "steady", "high"];
  const windows: UserTimeWindow[] = ["quick", "medium", "deep"];
  const styles: UserWorkStyle[] = ["gentle", "structured", "ambitious"];

  for (let i = 0; i < TASK_CATALOG_SIZE; i++) {
    const goal = pick(USER_GOALS, i);
    const goalIndex = Math.floor(i / USER_GOALS.length);
    const energy = pick(energies, goalIndex);
    const timeWindow = pick(windows, Math.floor(goalIndex / energies.length));
    const workStyle = pick(styles, Math.floor(goalIndex / (energies.length * windows.length)));
    const seed = pick(GOAL_SEEDS[goal], goalIndex);
    const prefix = pick(ENERGY_PREFIX[energy], goalIndex);
    const detail = pick(TIME_DETAIL[timeWindow], Math.floor(goalIndex / 2));
    const suffix = pick(STYLE_SUFFIX[workStyle], Math.floor(goalIndex / 3));
    const context = pick(CONTEXTS, Math.floor(goalIndex / 5));
    const outcome = pick(OUTCOMES, Math.floor(goalIndex / 7));

    tasks.push({
      id: `${goal}-${i}`,
      goal,
      text: `${prefix} ${seed} ${detail} ${context} ${suffix}, ${outcome}`,
      energy,
      timeWindow,
      workStyle,
    });
  }

  return tasks;
}

export const TASK_CATALOG = buildTaskCatalog();
export const TASKS_BY_GOAL: Record<UserGoal, CatalogTask[]> = USER_GOALS.reduce(
  (groups, goal) => {
    groups[goal] = TASK_CATALOG.filter((task) => task.goal === goal);
    return groups;
  },
  {} as Record<UserGoal, CatalogTask[]>,
);

function scoreTask(task: CatalogTask, profile: UserProfile): number {
  let score = 0;
  if (profile.goals.includes(task.goal)) score += 8;
  if (task.energy === profile.energy) score += 3;
  if (task.timeWindow === profile.timeWindow) score += 3;
  if (task.workStyle === profile.workStyle) score += 2;
  return score;
}

function hashText(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function personalizedTaskSuggestions(
  profile: UserProfile,
  today: string,
  count = 6,
  excludedTexts: string[] = [],
): CatalogTask[] {
  const excluded = new Set(excludedTexts.map((text) => text.trim().toLowerCase()));
  const ranked = TASK_CATALOG.filter(
    (task) => !excluded.has(task.text.trim().toLowerCase()),
  ).map((task) => ({
    task,
    score: scoreTask(task, profile),
    tieBreaker: hashText(`${today}:${task.id}`),
  })).sort((a, b) => b.score - a.score || a.tieBreaker - b.tieBreaker);

  return ranked.slice(0, count).map((entry) => entry.task);
}

export function randomPersonalizedTask(
  profile: UserProfile,
  today: string,
  attempt: number,
  excludedTexts: string[] = [],
): CatalogTask {
  const pool = personalizedTaskSuggestions(profile, today, 48, excludedTexts);
  return pool[attempt % pool.length] as CatalogTask;
}
