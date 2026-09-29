// Test harness for the focus screen on the real store (1.3): the screen is
// the session's detail view, so its timer tests run against the store's
// session (persisted, notification, settle) rather than a stand-in.
// Tests using it mock "@/lib/daily-tasks/notifications" (see FOCUS_NOTIFICATIONS_MOCK).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AccessibilityInfo } from "react-native";
import { act } from "@testing-library/react-native";

import { FocusMode } from "@/components/daily-tasks/focus-mode";
import { useFocusSessionCues } from "@/hooks/use-focus-session-cues";
import { DailyTasksProvider, useDailyTasks } from "@/lib/daily-tasks/store";
import { buildInitialState } from "@/lib/daily-tasks/storage";
import type { Task } from "@/lib/daily-tasks/types";

import { renderWithProviders } from "./render";

export interface FocusHarnessProps {
  startLine?: string | null;
  initialCustom?: boolean;
  onToggleStep?: (stepId: string) => void;
  onDone?: (timer: number) => void;
  onClose?: () => void;
  /** Set to false to unmount the screen while the store stays. */
  open?: boolean;
}

/** FocusMode on the first open task, wired to the store like Today wires it. */
function FocusHarness({ startLine = null, initialCustom, onToggleStep, onDone, onClose, open = true }: FocusHarnessProps) {
  const store = useDailyTasks();
  useFocusSessionCues(store.state.focusSession, store.ready);
  const task = store.state.tasks.find((item) => !store.isCompleted(item.id));
  if (!store.ready || !task || !open) return null;
  const session = store.state.focusSession?.taskId === task.id ? store.state.focusSession : null;
  return (
    <FocusMode
      task={task}
      startLine={startLine}
      session={session}
      initialCustom={initialCustom}
      onToggleStep={onToggleStep ?? ((stepId) => store.toggleTaskStep(task.id, stepId))}
      onDone={onDone ?? (() => store.toggleTask(task.id))}
      onClose={onClose ?? (() => {})}
      onStartTimer={(minutes) => store.startFocusSession(task.id, { kind: "timer", minutes, source: "focus" })}
      controls={{
        pause: store.pauseFocusSession,
        resume: store.resumeFocusSession,
        stop: () => store.stopFocusSession("stopped"),
        takeBreak: () => store.stopFocusSession("break"),
        extend: store.extendFocusSession,
        keepGoing: store.keepGoingFocusSession,
        done: () => store.toggleTask(task.id),
      }}
    />
  );
}

/** Saves today's state with `tasks` (the store loads it), then renders the harness. */
export async function renderFocusOnStore(tasks: Task[], props: FocusHarnessProps = {}) {
  await AsyncStorage.setItem(
    "daily-tasks/state/v1",
    JSON.stringify({ ...buildInitialState(new Date()), hasSeenOnboarding: true, tasks }),
  );
  const view = await renderWithProviders(
    <DailyTasksProvider>
      <FocusHarness {...props} />
    </DailyTasksProvider>,
  );
  // Let the saved state load.
  for (let i = 0; i < 5; i++) await act(async () => {});
  const rerender = (next: FocusHarnessProps) =>
    view.rerender(
      <DailyTasksProvider>
        <FocusHarness {...props} {...next} />
      </DailyTasksProvider>,
    );
  return { view, rerender };
}

/**
 * What was read out: the polite (queued) announcements the session makes, and
 * the plain ones. Spy with `spyOnAnnouncements()` first.
 */
export function spyOnAnnouncements(): () => string[] {
  const said: string[] = [];
  jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation((text) => void said.push(text));
  jest
    .spyOn(AccessibilityInfo, "announceForAccessibilityWithOptions")
    .mockImplementation((text) => void said.push(text));
  return () => [...said];
}
