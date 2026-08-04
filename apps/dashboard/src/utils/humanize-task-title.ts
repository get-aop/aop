/**
 * Turns a task slug into a short, friendly title for cards and step rows.
 * Strips the trailing random hash (e.g. `--054b1045`) and renders the rest as
 * sentence case. The raw slug should still be kept in a `title=` attribute by
 * the caller; truncation to one line is a CSS concern, not this function's.
 *
 *   humanizeTaskTitle("add-icons-on-every-sidebar-item-and-make-collapse--054b1045")
 *     -> "Add icons on every sidebar item and make collapse"
 */
export function humanizeTaskTitle(slug: string): string {
  const tail = slug.split("/").pop() ?? slug;
  // Strip a trailing hex hash: >=6 hex chars containing at least one digit, so
  // real all-letter words that happen to be hex (e.g. "facade") are preserved.
  const withoutHash = tail.replace(/-+(?=[0-9a-f]*[0-9])[0-9a-f]{6,}$/i, "");
  const words = withoutHash.split(/[-_]+/).filter(Boolean);
  if (words.length === 0) return tail;

  const sentence = words.join(" ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}
