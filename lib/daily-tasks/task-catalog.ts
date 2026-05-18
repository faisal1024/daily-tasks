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
  tags: string[];
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

interface TaskBlueprint {
  verb: string;
  objects: string[];
  tags: string[];
}

interface TaskModifier {
  text: string;
  energy: UserEnergy;
  timeWindow: UserTimeWindow;
  workStyle: UserWorkStyle;
  tags: string[];
}

const GOAL_BLUEPRINTS: Record<UserGoal, TaskBlueprint[]> = {
  health: [
    {
      verb: "Walk",
      objects: ["around the block", "upstairs", "outside", "one lap", "ten minutes", "to the corner", "in place", "to the mailbox", "near sunlight", "on a treadmill"],
      tags: ["movement", "cardio"],
    },
    {
      verb: "Stretch",
      objects: ["your neck", "your hips", "your back", "your calves", "your shoulders", "your wrists", "your hamstrings", "your ankles", "your chest", "your jaw"],
      tags: ["mobility", "recovery"],
    },
    {
      verb: "Prep",
      objects: ["a protein snack", "a water bottle", "a healthy lunch", "cut fruit", "washed greens", "overnight oats", "a balanced plate", "tea for tonight", "workout clothes", "tomorrow's breakfast"],
      tags: ["nutrition", "planning"],
    },
    {
      verb: "Do",
      objects: ["ten squats", "ten pushups", "a plank", "twenty jumping jacks", "a stair set", "a balance drill", "a breathing drill", "a posture reset", "a short mobility flow", "a light strength set"],
      tags: ["strength", "movement"],
    },
    {
      verb: "Track",
      objects: ["your water", "your steps", "your sleep", "your lunch", "your mood", "your energy", "your caffeine", "your symptoms", "your screen time", "your workout"],
      tags: ["tracking", "awareness"],
    },
    {
      verb: "Schedule",
      objects: ["a walk", "a workout", "bedtime", "a checkup", "a stretch break", "meal prep", "a grocery run", "a rest block", "a medication refill", "a health call"],
      tags: ["planning", "body-care"],
    },
  ],
  career: [
    {
      verb: "Finish",
      objects: ["one work block", "one draft", "one ticket", "one follow-up", "one review", "one proposal", "one outline", "one decision", "one slide", "one task"],
      tags: ["execution", "focus"],
    },
    {
      verb: "Send",
      objects: ["a follow-up", "a status update", "a thank-you note", "one clear ask", "meeting notes", "a decision recap", "a handoff note", "a blocker update", "a calendar invite", "a feedback request"],
      tags: ["communication", "visibility"],
    },
    {
      verb: "Review",
      objects: ["your priorities", "your task board", "today's meetings", "one document", "one pull request", "your calendar", "your goals", "your inbox", "one metric", "one plan"],
      tags: ["planning", "clarity"],
    },
    {
      verb: "Draft",
      objects: ["a project note", "a meeting agenda", "a weekly update", "a decision memo", "a customer reply", "a launch checklist", "a learning note", "a roadmap item", "a risk list", "a next step"],
      tags: ["writing", "planning"],
    },
    {
      verb: "Clean",
      objects: ["your inbox", "your desktop", "your backlog", "one stale task", "your notes", "your bookmarks", "your calendar", "one document", "your workspace", "your reminders"],
      tags: ["organization", "maintenance"],
    },
    {
      verb: "Prepare",
      objects: ["one meeting", "one question", "one talking point", "one demo", "one update", "one metric", "one agenda", "one decision", "one example", "one next step"],
      tags: ["meetings", "readiness"],
    },
  ],
  learning: [
    {
      verb: "Read",
      objects: ["one page", "one chapter", "one article", "one lesson", "one example", "one note", "one tutorial", "one paper", "one summary", "one reference"],
      tags: ["reading", "input"],
    },
    {
      verb: "Practice",
      objects: ["one drill", "one problem", "one exercise", "one phrase", "one example", "one technique", "one flashcard set", "one quiz", "one sketch", "one repetition"],
      tags: ["practice", "skill-building"],
    },
    {
      verb: "Summarize",
      objects: ["one concept", "one lesson", "one chapter", "one mistake", "one article", "one video", "one example", "one formula", "one process", "one takeaway"],
      tags: ["retention", "reflection"],
    },
    {
      verb: "Teach",
      objects: ["one idea", "one method", "one shortcut", "one definition", "one example", "one workflow", "one rule", "one topic", "one answer", "one insight"],
      tags: ["retention", "explanation"],
    },
    {
      verb: "Save",
      objects: ["three references", "one useful quote", "one resource", "one bookmark", "one example", "one glossary term", "one checklist", "one diagram", "one template", "one note"],
      tags: ["research", "organization"],
    },
    {
      verb: "Review",
      objects: ["old notes", "missed questions", "one weak spot", "one flashcard deck", "one tutorial", "one saved link", "one example", "one practice log", "one topic", "one goal"],
      tags: ["review", "mastery"],
    },
  ],
  relationships: [
    {
      verb: "Text",
      objects: ["one friend", "a family member", "someone you miss", "your partner", "a mentor", "a teammate", "someone new", "an old contact", "someone grieving", "someone celebrating"],
      tags: ["connection", "check-in"],
    },
    {
      verb: "Schedule",
      objects: ["a call", "coffee", "dinner", "a walk", "quality time", "a family check-in", "a date night", "a catch-up", "a shared errand", "a visit"],
      tags: ["planning", "quality-time"],
    },
    {
      verb: "Thank",
      objects: ["someone helpful", "a teammate", "a friend", "your partner", "a family member", "a mentor", "a neighbor", "a coworker", "a teacher", "someone kind"],
      tags: ["gratitude", "connection"],
    },
    {
      verb: "Ask",
      objects: ["one real question", "how they are", "what they need", "about their week", "about their win", "about their stress", "for their opinion", "about their plans", "what would help", "what changed"],
      tags: ["listening", "care"],
    },
    {
      verb: "Share",
      objects: ["one honest update", "a useful link", "a kind memory", "good news", "a small appreciation", "one plan", "one boundary", "one invitation", "one photo", "one encouragement"],
      tags: ["communication", "openness"],
    },
    {
      verb: "Repair",
      objects: ["one tension", "a missed reply", "a misunderstanding", "one apology", "one boundary", "one loose end", "a delayed plan", "one expectation", "one hurt feeling", "one awkward moment"],
      tags: ["repair", "trust"],
    },
  ],
  home: [
    {
      verb: "Clear",
      objects: ["one counter", "one shelf", "the sink", "your desk", "the entryway", "one drawer", "the table", "one corner", "the nightstand", "the floor"],
      tags: ["tidying", "declutter"],
    },
    {
      verb: "Wash",
      objects: ["the dishes", "one laundry load", "your towels", "your sheets", "one mug", "the sink", "the stovetop", "one container", "the trash bin", "the mirror"],
      tags: ["cleaning", "maintenance"],
    },
    {
      verb: "Sort",
      objects: ["one drawer", "mail", "receipts", "laundry", "one shelf", "donations", "one box", "tools", "chargers", "pantry items"],
      tags: ["organization", "declutter"],
    },
    {
      verb: "Restock",
      objects: ["toilet paper", "soap", "coffee", "snacks", "pet supplies", "cleaning spray", "medicine", "laundry detergent", "paper towels", "pantry basics"],
      tags: ["errands", "supplies"],
    },
    {
      verb: "Fix",
      objects: ["one loose item", "a squeaky hinge", "a dead bulb", "one cable", "one label", "one handle", "one setting", "one leak", "one drawer", "one small issue"],
      tags: ["maintenance", "repair"],
    },
    {
      verb: "Prep",
      objects: ["tomorrow's bag", "your keys", "your outfit", "lunch containers", "the coffee maker", "the entryway", "the bedroom", "the kitchen", "one errand list", "one calm space"],
      tags: ["planning", "setup"],
    },
  ],
  finance: [
    {
      verb: "Review",
      objects: ["today's spending", "one account", "one bill", "your budget", "one subscription", "your savings", "one receipt", "one purchase", "your paycheck", "one statement"],
      tags: ["review", "money-clarity"],
    },
    {
      verb: "Pay",
      objects: ["one bill", "your credit card", "a utility bill", "one invoice", "one balance", "a medical bill", "one fee", "one payment", "one debt", "one reminder"],
      tags: ["bills", "follow-through"],
    },
    {
      verb: "Move",
      objects: ["money to savings", "cash to bills", "money to debt", "one spare amount", "cash to investing", "money to groceries", "funds to rent", "cash to taxes", "money to goals", "one buffer amount"],
      tags: ["saving", "planning"],
    },
    {
      verb: "Cancel",
      objects: ["one trial", "one subscription", "one unused app", "one renewal", "one service", "one fee", "one duplicate charge", "one paid add-on", "one membership", "one old plan"],
      tags: ["spending", "cleanup"],
    },
    {
      verb: "Compare",
      objects: ["one purchase", "two prices", "one quote", "one plan", "one renewal", "one insurance option", "one grocery item", "one service", "one fee", "one monthly cost"],
      tags: ["spending", "decision"],
    },
    {
      verb: "Log",
      objects: ["one receipt", "one expense", "one refund", "one invoice", "one transfer", "one bill", "one purchase", "one donation", "one tax item", "one cash payment"],
      tags: ["tracking", "records"],
    },
  ],
  creativity: [
    {
      verb: "Draft",
      objects: ["one idea", "one scene", "one sketch", "one hook", "one paragraph", "one melody", "one outline", "one caption", "one concept", "one thumbnail"],
      tags: ["drafting", "ideation"],
    },
    {
      verb: "Edit",
      objects: ["one paragraph", "one photo", "one sketch", "one clip", "one section", "one headline", "one color pass", "one sentence", "one beat", "one transition"],
      tags: ["editing", "craft"],
    },
    {
      verb: "Collect",
      objects: ["three references", "five ideas", "one color palette", "one mood image", "one sample", "one quote", "one texture", "one song", "one layout", "one example"],
      tags: ["research", "inspiration"],
    },
    {
      verb: "Make",
      objects: ["one rough version", "one tiny asset", "one draft", "one sample", "one page", "one beat", "one sketch", "one prototype", "one post", "one variation"],
      tags: ["making", "output"],
    },
    {
      verb: "Share",
      objects: ["one work-in-progress", "one draft", "one sample", "one question", "one update", "one screenshot", "one link", "one sketch", "one clip", "one lesson"],
      tags: ["sharing", "feedback"],
    },
    {
      verb: "Organize",
      objects: ["your references", "one folder", "your tools", "your workspace", "your drafts", "your assets", "one notebook", "your ideas", "your templates", "your files"],
      tags: ["organization", "setup"],
    },
  ],
  mindfulness: [
    {
      verb: "Breathe",
      objects: ["slowly", "before replying", "with eyes closed", "through stress", "for one minute", "before starting", "after standing", "before eating", "during a pause", "after work"],
      tags: ["breathing", "reset"],
    },
    {
      verb: "Write",
      objects: ["three honest lines", "one intention", "one worry", "one win", "one lesson", "one gratitude", "one boundary", "one feeling", "one question", "one next step"],
      tags: ["journaling", "reflection"],
    },
    {
      verb: "Notice",
      objects: ["one good thing", "your breathing", "your shoulders", "your mood", "your surroundings", "one sound", "one sensation", "one thought", "one need", "one pattern"],
      tags: ["presence", "awareness"],
    },
    {
      verb: "Pause",
      objects: ["before reacting", "between tasks", "before scrolling", "after a meeting", "before eating", "after commuting", "before bed", "during stress", "before speaking", "after finishing"],
      tags: ["pause", "self-regulation"],
    },
    {
      verb: "Release",
      objects: ["one expectation", "one open loop", "one small guilt", "one old worry", "one resentment", "one distraction", "one rushed thought", "one judgment", "one pressure", "one mental tab"],
      tags: ["letting-go", "calm"],
    },
    {
      verb: "Choose",
      objects: ["one intention", "one priority", "one boundary", "one slower pace", "one kind response", "one focus", "one calming action", "one helpful thought", "one reset", "one enough point"],
      tags: ["intention", "clarity"],
    },
  ],
};

const TASK_MODIFIERS: TaskModifier[] = [
  { text: "today", energy: "low", timeWindow: "quick", workStyle: "gentle", tags: ["daily"] },
  { text: "now", energy: "low", timeWindow: "quick", workStyle: "gentle", tags: ["quick-win"] },
  { text: "once", energy: "low", timeWindow: "quick", workStyle: "structured", tags: ["single-step"] },
  { text: "next", energy: "steady", timeWindow: "quick", workStyle: "structured", tags: ["next-step"] },
  { text: "before noon", energy: "steady", timeWindow: "quick", workStyle: "structured", tags: ["timed"] },
  { text: "before dinner", energy: "steady", timeWindow: "medium", workStyle: "structured", tags: ["timed"] },
  { text: "before bed", energy: "low", timeWindow: "quick", workStyle: "gentle", tags: ["evening"] },
  { text: "during a break", energy: "low", timeWindow: "quick", workStyle: "gentle", tags: ["break"] },
  { text: "this morning", energy: "steady", timeWindow: "medium", workStyle: "structured", tags: ["morning"] },
  { text: "this afternoon", energy: "steady", timeWindow: "medium", workStyle: "structured", tags: ["afternoon"] },
  { text: "this evening", energy: "steady", timeWindow: "medium", workStyle: "gentle", tags: ["evening"] },
  { text: "after lunch", energy: "steady", timeWindow: "medium", workStyle: "structured", tags: ["timed"] },
  { text: "after work", energy: "steady", timeWindow: "medium", workStyle: "gentle", tags: ["timed"] },
  { text: "this week", energy: "steady", timeWindow: "medium", workStyle: "structured", tags: ["weekly"] },
  { text: "before tomorrow", energy: "steady", timeWindow: "medium", workStyle: "ambitious", tags: ["follow-through"] },
  { text: "when ready", energy: "low", timeWindow: "quick", workStyle: "gentle", tags: ["low-pressure"] },
  { text: "with care", energy: "low", timeWindow: "medium", workStyle: "gentle", tags: ["careful"] },
  { text: "with focus", energy: "high", timeWindow: "deep", workStyle: "ambitious", tags: ["focus"] },
  { text: "gently", energy: "low", timeWindow: "quick", workStyle: "gentle", tags: ["gentle"] },
  { text: "intentionally", energy: "steady", timeWindow: "medium", workStyle: "structured", tags: ["intentional"] },
  { text: "as a quick win", energy: "high", timeWindow: "medium", workStyle: "ambitious", tags: ["momentum"] },
];

export const USER_GOALS = Object.keys(GOAL_META) as UserGoal[];
export const USER_GOAL_META = GOAL_META;
export const TASK_CATALOG_SIZE = 10_000;

function pick<T>(items: T[], index: number): T {
  return items[index % items.length] as T;
}

const GOAL_TASK_COUNT = TASK_CATALOG_SIZE / USER_GOALS.length;

const GOAL_TEXT_CONTEXT: Record<UserGoal, string> = {
  health: "for fitness",
  career: "for work",
  learning: "for study",
  relationships: "for connection",
  home: "at home",
  finance: "for money",
  creativity: "for making",
  mindfulness: "for calm",
};

function buildGoalTasks(goal: UserGoal, globalOffset: number): CatalogTask[] {
  const blueprints = GOAL_BLUEPRINTS[goal];
  const tasks: CatalogTask[] = [];
  const seen = new Set<string>();

  for (let blueprintIndex = 0; tasks.length < GOAL_TASK_COUNT; blueprintIndex++) {
    const blueprint = pick(blueprints, blueprintIndex);
    const objectIndex = Math.floor(blueprintIndex / blueprints.length);
    const object = pick(blueprint.objects, objectIndex);
    const modifierIndex = Math.floor(blueprintIndex / (blueprints.length * blueprint.objects.length));
    const modifier = pick(TASK_MODIFIERS, modifierIndex);
    const text = `${blueprint.verb} ${object} ${modifier.text}`;
    const normalized = text.toLowerCase();

    if (seen.has(normalized)) continue;
    seen.add(normalized);

    tasks.push({
      id: `${goal}-${globalOffset + tasks.length}`,
      goal,
      text,
      tags: [goal, ...blueprint.tags, ...modifier.tags],
      energy: modifier.energy,
      timeWindow: modifier.timeWindow,
      workStyle: modifier.workStyle,
    });
  }

  return tasks;
}

export function buildTaskCatalog(): CatalogTask[] {
  const globalTexts = new Set<string>();

  return USER_GOALS.flatMap((goal, index) =>
    buildGoalTasks(goal, index * GOAL_TASK_COUNT).map((task) => {
      const normalized = task.text.toLowerCase();
      if (!globalTexts.has(normalized)) {
        globalTexts.add(normalized);
        return task;
      }

      const text = `${task.text} ${GOAL_TEXT_CONTEXT[goal]}`;
      globalTexts.add(text.toLowerCase());
      return { ...task, text };
    }),
  );
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
