// Capture from anywhere (1.6 E): a thought gets out of your head without
// first opening the app and finding the brain dump.
//
// Two ways in, both through the App Group (see docs/2026-10-v1.6.md, "1.6 E"):
// - Open the brain dump: the Dump widget (Lock Screen / Home Screen), the
//   iOS 18 Dump control, the "Brain dump" shortcut, or any
//   `dailytasks://dump` link. The router hands links to queueCaptureOpen
//   (app/+native-intent.tsx); native code (the shortcut, the control) also
//   leaves the request in the App Group (`capture.openRequest`) in case a
//   cold start missed the link. Today opens the brain dump sheet.
// - Save a thought for later without opening the app: the share sheet's
//   "Three Today" and the "Save for later" shortcut ("Add to Three Today")
//   write it to the capture inbox, one file per capture in the App Group's
//   `capture-inbox/` folder. On the next open the app saves them, oldest
//   first, in Saved for later and says so; each file is deleted only once
//   that's stored for good. Never onto today's three, never a sheet the user
//   didn't ask for, and never a saved item pushed out: what doesn't fit
//   waits in the inbox (and Today says Saved for later is full).
//
// Text never goes into a link (or analytics): only the App Group.

export type CaptureSource = "widget" | "intent" | "share" | "link";

export interface CaptureOpenRequest {
  source: CaptureSource;
  /**
   * The request's id when native code made it: the same id is in the link
   * and in the App Group request, so one tap arriving both ways counts once.
   */
  id?: string;
}

/** One capture file from the inbox, read and cleaned. */
export interface CaptureItem {
  /** The file's name: deleted by that name once saved for good. */
  name: string;
  text: string;
  /** When it was captured (epoch ms). */
  at: number;
}

/** What's in the inbox, as the bridge reads it. */
export interface CaptureFile {
  name: string;
  contents: string;
}

/** A request left in the App Group is only acted on this soon after it was made. */
export const CAPTURE_REQUEST_MAX_AGE_MS = 60_000;
/** Saved items are one line: longer captures are cut (native code keeps up to 1000). */
export const MAX_CAPTURE_CHARS = 500;

const OPEN_SOURCES: readonly CaptureSource[] = ["widget", "intent", "link"];

function captureSource(value: unknown, fallback: CaptureSource): CaptureSource {
  return typeof value === "string" && (OPEN_SOURCES as readonly string[]).includes(value)
    ? (value as CaptureSource)
    : fallback;
}

/**
 * `dailytasks://dump` (`?source=widget|intent`, `&id=` from native code), or
 * the router's path (`/dump?...`). Null for anything else.
 */
export function parseCaptureLink(url: string | null | undefined): CaptureOpenRequest | null {
  if (!url) return null;
  const match = /^(?:[a-z][a-z0-9+.-]*:\/\/)?\/*dump\/*(?:\?([^#]*))?(?:#.*)?$/i.exec(url.trim());
  if (!match) return null;
  const params = new Map<string, string>();
  for (const pair of (match[1] ?? "").split("&")) {
    if (!pair) continue;
    const [key, value = ""] = pair.split("=");
    try {
      params.set(decodeURIComponent(key), decodeURIComponent(value.replace(/\+/g, " ")));
    } catch {
      // A malformed pair is ignored.
    }
  }
  const id = params.get("id");
  return { source: captureSource(params.get("source"), "link"), ...(id ? { id } : {}) };
}

/**
 * The open request native code left in the App Group, if it's new (not the
 * one last handled) and recent. Malformed JSON is ignored.
 */
export function parseCaptureOpenRequest(
  raw: string | null,
  handledId: string | null,
  now: number,
): (CaptureOpenRequest & { id: string }) | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const { id, source, at } = parsed as Record<string, unknown>;
  if (typeof id !== "string" || !id || id === handledId) return null;
  if (typeof at !== "number" || !Number.isFinite(at) || Math.abs(now - at) > CAPTURE_REQUEST_MAX_AGE_MS) return null;
  return { id, source: captureSource(source, "intent") };
}

/** One line, trimmed and cut to MAX_CAPTURE_CHARS; null when nothing is left. */
export function cleanCaptureText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return null;
  const chars = Array.from(text);
  return chars.length > MAX_CAPTURE_CHARS ? `${chars.slice(0, MAX_CAPTURE_CHARS - 1).join("").trimEnd()}…` : text;
}

/**
 * The inbox's captures, oldest first (by `at`, then name), and the files that
 * can never be saved (malformed, or no text left): those are deleted at once.
 */
export function parseCaptureFiles(files: readonly CaptureFile[]): { items: CaptureItem[]; junk: string[] } {
  const items: CaptureItem[] = [];
  const junk: string[] = [];
  for (const file of files) {
    if (!file || typeof file.name !== "string" || !file.name) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(file.contents);
    } catch {
      junk.push(file.name);
      continue;
    }
    const { text, at } = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
    const clean = cleanCaptureText(text);
    if (!clean) {
      junk.push(file.name);
      continue;
    }
    items.push({ name: file.name, text: clean, at: typeof at === "number" && Number.isFinite(at) ? at : 0 });
  }
  items.sort((a, b) => a.at - b.at || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { items, junk };
}

const sameText = (text: string) => text.trim().toLowerCase();

/**
 * Which captures to save now. `save`: new ones, oldest first, only as many
 * as Saved for later has room for (it never pushes a saved item out).
 * `present`: already in Saved for later or on today's list (or earlier in
 * this batch): nothing to add, their files can go. `waiting`: no room yet;
 * they stay in the inbox until some saved items are cleared.
 */
export function planCaptureImport(
  state: { parkedTasks: readonly { text: string }[]; tasks: readonly { text: string }[] },
  items: readonly CaptureItem[],
  maxSaved: number,
): { save: CaptureItem[]; present: CaptureItem[]; waiting: CaptureItem[] } {
  const taken = new Set([...state.parkedTasks, ...state.tasks].map((entry) => sameText(entry.text)));
  let room = Math.max(0, maxSaved - state.parkedTasks.length);
  const save: CaptureItem[] = [];
  const present: CaptureItem[] = [];
  const waiting: CaptureItem[] = [];
  for (const item of items) {
    const key = sameText(item.text);
    if (taken.has(key)) present.push(item);
    else if (room > 0) {
      save.push(item);
      taken.add(key);
      room -= 1;
    } else {
      // No room: it waits (a later copy of the same text too; once one is
      // saved, the other is already there).
      waiting.push(item);
    }
  }
  return { save, present, waiting };
}

/** What Today says once captures are saved, or when Saved for later is full. */
export interface CaptureNotice {
  /** How many were saved now. */
  count: number;
  /** The one saved, when it's one. */
  text: string | null;
  /** Some are still waiting: Saved for later is full. */
  full: boolean;
}

const TOAST_QUOTE_CHARS = 40;
export const CAPTURE_FULL_TOAST = "Saved for later is full. Clear a few in Ideas to bring in the rest.";

export function captureToast(notice: CaptureNotice): string | null {
  const parts: string[] = [];
  if (notice.count === 1 && notice.text) {
    const chars = Array.from(notice.text);
    const quote =
      chars.length > TOAST_QUOTE_CHARS ? `${chars.slice(0, TOAST_QUOTE_CHARS - 1).join("").trimEnd()}…` : notice.text;
    parts.push(`Saved for later: “${quote}”`);
  } else if (notice.count > 0) {
    parts.push(`${notice.count} thoughts saved for later`);
  }
  if (notice.full) parts.push(CAPTURE_FULL_TOAST);
  return parts.length > 0 ? parts.join(". ") : null;
}

// Links arrive before the store is ready (a cold start): they wait here.
type Listener = () => void;
let pending: CaptureOpenRequest[] = [];
const listeners = new Set<Listener>();

export function queueCaptureOpen(request: CaptureOpenRequest): void {
  pending.push(request);
  listeners.forEach((listener) => listener());
}

/** Take (and clear) what's waiting. */
export function takeCaptureOpens(): CaptureOpenRequest[] {
  const taken = pending;
  pending = [];
  return taken;
}

export function subscribeCaptureOpens(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only. */
export function __resetCaptureForTests(): void {
  pending = [];
  listeners.clear();
}
