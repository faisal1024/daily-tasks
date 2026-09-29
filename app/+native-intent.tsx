// Deep links from outside the app (1.3): "start my next task" from the widget
// and Siri (`dailytasks://focus/start?task=next&source=widget|siri`, plus
// `kind=starter`). The router asks here first, for a cold start and while
// running; the request waits in focus-link.ts until the store is ready, and
// the app shows Today. Every other link goes through unchanged.
import { parseFocusStartLink, queueFocusStart } from "@/lib/daily-tasks/focus-link";

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    const request = parseFocusStartLink(path);
    if (!request) return path;
    queueFocusStart(request);
    return "/";
  } catch {
    return "/";
  }
}
