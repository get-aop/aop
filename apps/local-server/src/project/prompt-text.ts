/** Small text helpers for what project sessions are told. Lengths are UTF-16 code units, as `string.length`. */

/** At most `max` characters, the last one an ellipsis when the text was cut. */
export const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

/** One line: any run of whitespace, newlines included, becomes a space, so a value cannot open a new line or heading. */
export const oneLine = (text: string, max: number): string =>
  clip(text.replace(/\s+/g, " ").trim(), max);

/**
 * The first `max` characters, ended at the last line break when the cut falls inside a line, so
 * a rule is never left half-written. A single line longer than `max` is cut where it stands.
 */
export const cutAtLine = (text: string, max: number): string => {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  // A break earlier than the last fifth would give up too much of the room; cut the line instead.
  const lastBreak = head.lastIndexOf("\n");
  return lastBreak >= max * 0.8 ? head.slice(0, lastBreak) : head;
};
