// Emphasis and strike-through pairs. The underscore forms must stand at a word edge, so
// `snake_case_names` and file names keep their underscores.
const INLINE_MARKERS: readonly RegExp[] = [
  /\*\*(.+?)\*\*/g,
  /(?<![\w_])__(.+?)__(?![\w_])/g,
  /~~(.+?)~~/g,
  /\*(?!\s)(.+?)(?<!\s)\*/g,
  /(?<![\w_])_(?!\s)(.+?)(?<!\s)_(?![\w_])/g,
  /`([^`]+)`/g,
];

/**
 * A status line as plain text. Threads write theirs in whatever style their model likes, and a
 * one-line row would show `**formal**` as typed, so the inline markers go and their text stays.
 */
export const plainStatusLine = (line: string): string => {
  const unlinked = line.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  return INLINE_MARKERS.reduce((text, marker) => text.replace(marker, "$1"), unlinked);
};
