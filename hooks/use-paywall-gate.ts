// Opening the paywall from a gated feature, and picking up where the user
// was once it closes (bought or not). Shared by Today and Settings.
import { useCallback, useEffect, useRef } from "react";

import { track } from "@/lib/daily-tasks/analytics";
import type { PaywallSource, PlusFeature } from "@/lib/daily-tasks/plus";
import { usePlus } from "@/lib/daily-tasks/plus-context";

/**
 * iOS shows one modal at a time: how long a closing sheet takes to animate
 * away before the next one (or the paywall) can come up.
 */
export const SHEET_SWAP_DELAY_MS = 650;

export interface ShowPaywallOptions<U> {
  /** Tracked as plus_gate_hit. */
  feature?: PlusFeature;
  /** A sheet is closing first: wait for it before opening the paywall. */
  afterSheet?: boolean;
  /** Handed to `onResume` once the paywall closes. */
  resume?: U;
  /** For the onboarding headline ("Your three are set."). */
  taskCount?: number;
}

/**
 * `showPaywall(source, options)`; `onResume(unlock)` runs after the paywall
 * has closed and animated away, with the `resume` it was opened with (it reads
 * Plus as of then, so it can tell a purchase from a dismissal). Several gates
 * can live on one screen: each only resumes what it opened.
 */
export function usePaywallGate<U>(onResume: (unlock: U) => void) {
  const { paywallSource, openPaywall } = usePlus();
  const onResumeRef = useRef(onResume);
  onResumeRef.current = onResume;

  // What to pick back up once the paywall closes.
  const pendingUnlock = useRef<U | null>(null);
  const paywallTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (paywallTimer.current) clearTimeout(paywallTimer.current);
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
    },
    [],
  );

  const showPaywall = useCallback(
    (source: PaywallSource, options: ShowPaywallOptions<U> = {}) => {
      if (options.feature) track("plus_gate_hit", { feature: options.feature });
      const unlock = options.resume ?? null;
      if (paywallTimer.current) clearTimeout(paywallTimer.current);
      const open = () => {
        pendingUnlock.current = unlock;
        // Didn't open (e.g. a paywall is already up elsewhere): nothing to resume.
        const opened =
          options.taskCount === undefined ? openPaywall(source) : openPaywall(source, { taskCount: options.taskCount });
        if (!opened) pendingUnlock.current = null;
      };
      if (!options.afterSheet) {
        open();
        return;
      }
      paywallTimer.current = setTimeout(() => {
        paywallTimer.current = null;
        open();
      }, SHEET_SWAP_DELAY_MS);
    },
    [openPaywall],
  );

  const paywallOpenRef = useRef(false);
  paywallOpenRef.current = paywallSource !== null;
  const paywallWasOpen = useRef(false);
  useEffect(() => {
    if (paywallSource) {
      paywallWasOpen.current = true;
      return;
    }
    if (!paywallWasOpen.current) return;
    paywallWasOpen.current = false;
    const unlock = pendingUnlock.current;
    pendingUnlock.current = null;
    if (unlock === null) return;
    // Let the paywall animate away before presenting another sheet.
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(() => {
      resumeTimer.current = null;
      // A paywall came back up meanwhile: keep the unlock for when it closes.
      if (paywallOpenRef.current) {
        pendingUnlock.current = unlock;
        paywallWasOpen.current = true;
        return;
      }
      onResumeRef.current(unlock);
    }, SHEET_SWAP_DELAY_MS);
  }, [paywallSource]);

  return showPaywall;
}
