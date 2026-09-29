// Minimal, privacy-first product analytics (PostHog's HTTP capture API).
//
// - Off unless EXPO_PUBLIC_POSTHOG_KEY is set at build time, and the user can
//   turn it off in Settings.
// - Anonymous: a random install id, no name, no device id, no IP-based person
//   profile ($ip is dropped), and never any task, goal or brain-dump text.
//   Event properties are restricted to an allowlist of short values.
// - Plain fetch, no native SDK: events are batched and sent in the background;
//   failures are dropped silently (analytics must never affect the app).

import AsyncStorage from "@react-native-async-storage/async-storage";

import { getCurrentVersion } from "./app-update";

export type AnalyticsEvent =
  | "app_opened"
  | "onboarding_completed"
  | "task_completed"
  | "perfect_day"
  | "brain_dump_sorted"
  | "break_down_used"
  | "plus_gate_hit"
  | "paywall_viewed"
  | "paywall_closed"
  | "purchase_started"
  | "purchase_completed"
  | "purchase_failed"
  | "restore_completed"
  | "redeem_code_opened"
  | "path_edited"
  | "path_regenerated"
  | "app_error"
  | "evening_closed"
  | "tomorrow_draft_used"
  | "onboarding_step"
  | "agenda_toggled"
  | "goal_set"
  | "task_not_today"
  | "rollover_resolved"
  | "coach_note_loaded"
  | "focus_opened"
  | "focus_completed"
  | "focus_session_started"
  | "focus_session_ended"
  | "live_activity_action";

type PropValue = string | number | boolean;
export type AnalyticsProps = Partial<Record<AllowedProp, PropValue>>;

const ALLOWED_PROPS = [
  "source",
  "plan",
  "outcome",
  "trial",
  "count",
  "skipped",
  "feature",
  "active",
  "plus",
  "step",
  "timer",
  "kind",
  "minutes",
  "action",
] as const;
type AllowedProp = (typeof ALLOWED_PROPS)[number];

const ID_KEY = "daily-tasks/analytics-id";
const DEFAULT_HOST = "https://us.i.posthog.com";
const FLUSH_DELAY_MS = 5_000;
const MAX_QUEUE = 100;

export function getPostHogKey(): string | null {
  const key = process.env.EXPO_PUBLIC_POSTHOG_KEY?.trim();
  return key ? key : null;
}

function getHost(): string {
  const host = process.env.EXPO_PUBLIC_POSTHOG_HOST?.trim();
  return (host || DEFAULT_HOST).replace(/\/+$/, "");
}

/** Keep only allowlisted keys with short primitive values (never free text). */
export function sanitizeProps(props: Record<string, unknown> | undefined): AnalyticsProps {
  const out: AnalyticsProps = {};
  if (!props) return out;
  for (const key of ALLOWED_PROPS) {
    const value = props[key];
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "boolean") out[key] = value;
    else if (typeof value === "string" && /^[a-z0-9_.-]{1,40}$/i.test(value)) out[key] = value;
  }
  return out;
}

interface QueuedEvent {
  event: AnalyticsEvent;
  properties: AnalyticsProps;
  timestamp: string;
}

// Off until the store applies the saved Settings choice after loading.
let enabled = false;
let distinctId: string | null = null;
let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let fetchImpl: typeof fetch = (...args) => fetch(...args);

function randomId(): string {
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  return `anon_${bytes.map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

async function getDistinctId(): Promise<string> {
  if (distinctId) return distinctId;
  try {
    const stored = await AsyncStorage.getItem(ID_KEY);
    if (stored) {
      distinctId = stored;
      return stored;
    }
  } catch {
    // fall through to a fresh id
  }
  distinctId = randomId();
  try {
    await AsyncStorage.setItem(ID_KEY, distinctId);
  } catch {
    // an unsaved id only means this install may be counted twice
  }
  return distinctId;
}

/** Follow the user's Settings choice. Turning it off drops anything queued. */
export function setAnalyticsEnabled(value: boolean): void {
  enabled = value;
  if (!value) {
    queue = [];
    if (timer) clearTimeout(timer);
    timer = null;
  }
}

export function isAnalyticsActive(): boolean {
  return enabled && getPostHogKey() !== null;
}

/** Record an event. A no-op when analytics is off or not configured. */
export function track(event: AnalyticsEvent, props?: Record<string, unknown>): void {
  if (!isAnalyticsActive()) return;
  if (queue.length >= MAX_QUEUE) queue.shift();
  queue.push({ event, properties: sanitizeProps(props), timestamp: new Date().toISOString() });
  if (!timer) timer = setTimeout(() => void flush(), FLUSH_DELAY_MS);
}

/** Send queued events now. Never throws. */
export async function flush(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  const key = getPostHogKey();
  if (!key || !enabled || queue.length === 0) return;
  const batch = queue;
  queue = [];
  try {
    const id = await getDistinctId();
    // The user may have turned analytics off while the id was loading.
    if (!enabled) return;
    await fetchImpl(`${getHost()}/batch/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        batch: batch.map((item) => ({
          event: item.event,
          timestamp: item.timestamp,
          properties: {
            ...item.properties,
            distinct_id: id,
            app_version: getCurrentVersion(),
            // Anonymous events only: no person profiles, no stored IP.
            $process_person_profile: false,
            $ip: null,
            $geoip_disable: true,
          },
        })),
      }),
    });
  } catch {
    // Dropped on purpose: analytics must never retry-storm or surface errors.
  }
}

/** "Reset all data": forget the anonymous id so the next events start fresh. */
export async function resetAnalyticsIdentity(): Promise<void> {
  distinctId = null;
  queue = [];
  try {
    await AsyncStorage.removeItem(ID_KEY);
  } catch {
    // a stale id only links the reset install to its earlier events
  }
}

/** Test-only hooks. */
export function __setAnalyticsFetchForTests(impl: typeof fetch): void {
  fetchImpl = impl;
}
export function __resetAnalyticsForTests(): void {
  enabled = true;
  distinctId = null;
  queue = [];
  if (timer) clearTimeout(timer);
  timer = null;
  fetchImpl = (...args) => fetch(...args);
}
