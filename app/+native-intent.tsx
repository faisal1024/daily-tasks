// Deep links from outside the app (1.3): "start my next task" from the widget
// and Siri (`dailytasks://focus/start?task=next&source=widget|siri`, plus
// `kind=starter`), and a tap on the Live Activity (`dailytasks://focus?session=<id>`).
// The router asks here first, for a cold start and while
// running; the request waits in focus-link.ts until the store is ready, and
// the app shows Today. Every other link goes through unchanged.
import {
  isFocusLink,
  parseFocusOpenLink,
  parseFocusStartLink,
  queueFocusOpen,
  queueFocusStart,
} from "@/lib/daily-tasks/focus-link";

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    const start = parseFocusStartLink(path);
    if (start) {
      queueFocusStart(start);
      return "/";
    }
    // A tap on the Live Activity: its focus screen (Today opens it).
    const open = parseFocusOpenLink(path);
    if (open) {
      queueFocusOpen(open);
      return "/";
    }
    // Any other focus link (an unknown task, a newer app's link) is just Today:
    // there's no such route.
    return isFocusLink(path) ? "/" : path;
  } catch {
    return "/";
  }
}
