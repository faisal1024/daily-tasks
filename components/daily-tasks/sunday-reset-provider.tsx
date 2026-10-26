// One Sunday reset sheet for the whole app (1.6), mounted at the tabs layout:
// Today's card, Progress's row and the Sunday notification all open the same
// sheet through `start()`. Today reads `isOpen` (no rating ask, What's new
// or focus screen on top of it) and calls `stepAside()` when something must
// come up instead: the sheet closes as its × does, so a typed dump is saved.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { usePaywallGate } from "@/hooks/use-paywall-gate";
import { track } from "@/lib/daily-tasks/analytics";
import { useDailyTasks } from "@/lib/daily-tasks/store";
import { subscribeSundayResetResponses } from "@/lib/daily-tasks/sunday-reset-response";

import { SundayResetSheet, type SundayResetSheetHandle, type SundayResetSource } from "./sunday-reset-sheet";

export interface SundayResetApi {
  /** The sheet is up. */
  isOpen: boolean;
  /** The sheet with Plus; otherwise the paywall (source `sunday_reset`), then the sheet if bought. */
  start: (source: SundayResetSource) => void;
  /** Close an open sheet as its × does (typed text is saved). True when one was open. */
  stepAside: () => boolean;
}

const NO_PROVIDER: SundayResetApi = { isOpen: false, start: () => {}, stepAside: () => false };
const SundayResetContext = createContext<SundayResetApi>(NO_PROVIDER);

export function useSundayReset(): SundayResetApi {
  return useContext(SundayResetContext);
}

export function SundayResetProvider({ children }: { children: ReactNode }) {
  const { ready, hasPlus, state } = useDailyTasks();
  const [open, setOpen] = useState<SundayResetSource | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const sheet = useRef<SundayResetSheetHandle>(null);
  const hasPlusRef = useRef(hasPlus);
  hasPlusRef.current = hasPlus;
  const showPaywall = usePaywallGate<SundayResetSource>((source) => {
    // Read as of the paywall closing: bought → straight into the reset.
    if (hasPlusRef.current) setOpen(source);
  });

  const start = useCallback(
    (source: SundayResetSource) => {
      if (openRef.current) return;
      if (hasPlusRef.current) {
        setOpen(source);
        return;
      }
      track("sunday_reset", { step: source === "today" ? "intro" : "card", action: "plus", source });
      showPaywall("sunday_reset", { feature: "sunday_reset", resume: source });
    },
    [showPaywall],
  );

  const stepAside = useCallback(() => {
    if (!openRef.current) return false;
    if (sheet.current) sheet.current.close();
    else setOpen(null);
    return true;
  }, []);

  // A tap on the Sunday notification opens the reset (once the app has
  // loaded, after first run, and only with Plus: it is a Plus notification).
  const [tapped, setTapped] = useState(0);
  const tapPending = useRef(false);
  useEffect(
    () =>
      subscribeSundayResetResponses(() => {
        tapPending.current = true;
        setTapped((count) => count + 1);
      }),
    [],
  );
  useEffect(() => {
    if (!tapPending.current || !ready || !state.hasSeenOnboarding) return;
    tapPending.current = false;
    if (!hasPlus || openRef.current) return;
    track("sunday_reset", { step: "card", action: "start", source: "notification" });
    setOpen("notification");
  }, [tapped, ready, state.hasSeenOnboarding, hasPlus]);

  const value = useMemo(() => ({ isOpen: open !== null, start, stepAside }), [open, start, stepAside]);
  return (
    <SundayResetContext.Provider value={value}>
      {children}
      <SundayResetSheet ref={sheet} visible={open !== null} onClose={() => setOpen(null)} source={open ?? "today"} />
    </SundayResetContext.Provider>
  );
}
