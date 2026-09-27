/**
 * Where the run of `chars` at the end of `text` starts, or `text.length` when it does not end in one of them.
 *
 * A loop from the end, not a regex like `/\/+$/`: a regex engine tries the run again from every position in it, so
 * a long run followed by another character takes quadratic time.
 */
export function trailingRunStart(text: string, chars: string): number {
  let start = text.length;
  while (start > 0 && chars.includes(text.charAt(start - 1))) start--;
  return start;
}

/** `text` without the run of `chars` at its end, like `text.replace(/[chars]+$/, '')` in linear time. */
export function trimTrailing(text: string, chars: string): string {
  return text.slice(0, trailingRunStart(text, chars));
}
