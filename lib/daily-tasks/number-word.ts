const WORDS = ["no", "one", "two", "three"];

/**
 * A small count as a word ("one", "two", "three"; 0 is "no"), else digits.
 * Shared so the suggestions header and the evening draft count alike.
 */
export function numberWord(count: number): string {
  return WORDS[count] ?? String(count);
}
