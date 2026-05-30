import { useCallback, useEffect, useRef, useState } from "react";
import { AppState as RNAppState, type AppStateStatus } from "react-native";

import { checkForUpdate, dismissUpdate, type UpdateInfo } from "@/lib/daily-tasks/app-update";

/**
 * Checks for a newer published app version on mount and whenever the app
 * returns to the foreground. Returns the update (if any) and a dismiss action
 * that remembers the version so the prompt does not reappear for it.
 */
export function useAppUpdate(): { update: UpdateInfo | null; dismiss: () => void } {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const checking = useRef(false);

  const run = useCallback(async () => {
    if (checking.current) return;
    checking.current = true;
    try {
      const info = await checkForUpdate();
      setUpdate(info);
    } finally {
      checking.current = false;
    }
  }, []);

  useEffect(() => {
    void run();
    const onChange = (status: AppStateStatus) => {
      if (status === "active") void run();
    };
    const sub = RNAppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, [run]);

  const dismiss = useCallback(() => {
    setUpdate((current) => {
      if (current) void dismissUpdate(current.latestVersion);
      return null;
    });
  }, []);

  return { update, dismiss };
}
