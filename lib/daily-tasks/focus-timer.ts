// Focus mode's timer copy (1.2), shared by the screen and its notification.

/** Said when a focus timer ends, on screen and in the notification. */
export function timesUpText(minutes: number): string {
  return `That's ${minutes} minutes. Keep going, or take a break.`;
}
