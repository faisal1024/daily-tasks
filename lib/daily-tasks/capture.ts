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
//   "Three Today" and the "Add to Three Today" shortcut append it to the
//   capture inbox (`capture.inbox`). On the next open the app saves each one
//   in Ideas → Saved for later and says so. Never onto today's three, and
//   never a sheet the user didn't ask for.
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

export interface CaptureItem {
  seq: number;
  text: string;
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
 * The inbox's captures the app hasn't saved yet (seq above `processedSeq`),
 * oldest first, and the last seq read (to mark processed, including entries
 * dropped as empty or malformed: those can never be saved). Malformed JSON
 * reads as empty.
 */
export function parseCaptureInbox(
  raw: string | null,
  processedSeq: number,
): { items: CaptureItem[]; lastSeq: number } {
  const none = { items: [], lastSeq: processedSeq };
  if (!raw) return none;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return none;
  }
  if (!Array.isArray(parsed)) return none;
  let lastSeq = processedSeq;
  const items: CaptureItem[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const { seq, text } = entry as Record<string, unknown>;
    if (typeof seq !== "number" || !Number.isInteger(seq) || seq <= processedSeq) continue;
    lastSeq = Math.max(lastSeq, seq);
    const clean = cleanCaptureText(text);
    if (clean) items.push({ seq, text: clean });
  }
  items.sort((a, b) => a.seq - b.seq);
  return { items, lastSeq };
}

/** What Today says once captures are saved. */
export function captureToast(count: number): string {
  return count === 1
    ? "Your captured thought is saved for later in Ideas."
    : `${count} captured thoughts saved for later in Ideas.`;
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
