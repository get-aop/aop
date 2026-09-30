type TypeaheadKind = "repo";

export interface TypeaheadItem {
  id: string;
  label: string;
  kind: TypeaheadKind;
  insertText: string;
}

export interface TypeaheadMatch {
  items: TypeaheadItem[];
  /** Start index in the draft of the token being completed. */
  tokenStart: number;
  query: string;
  kind: TypeaheadKind;
}

/**
 * Typeahead for `~repo` mentions. Pure helper so unit tests can drive matching
 * without a browser.
 */
export const matchTypeahead = (input: {
  draft: string;
  caret: number;
  repos: Array<{ id: string; name: string | null; path: string }>;
}): TypeaheadMatch | null => {
  const before = input.draft.slice(0, input.caret);
  const tokenMatch = before.match(/(?:^|\s)~([^\s]*)$/);
  if (!tokenMatch) return null;

  const query = (tokenMatch[1] ?? "").toLowerCase();
  const tokenStart = before.length - (tokenMatch[1]?.length ?? 0) - 1;
  return matchRepos(input.repos, query, tokenStart);
};

const matchRepos = (
  repos: Array<{ id: string; name: string | null; path: string }>,
  query: string,
  tokenStart: number,
): TypeaheadMatch | null => {
  const items = repos
    .filter((repo) => {
      const label = (repo.name ?? repo.path).toLowerCase();
      return label.includes(query) || repo.id.toLowerCase().includes(query);
    })
    .slice(0, 8)
    .map((repo) => ({
      id: repo.id,
      label: repo.name ?? repo.path,
      kind: "repo" as const,
      insertText: `~${repo.name ?? repo.id} `,
    }));
  if (isExactCompletedToken(query, items)) return null;
  return { items, tokenStart, query, kind: "repo" };
};

export const applyTypeaheadInsert = (
  draft: string,
  tokenStart: number,
  caret: number,
  insertText: string,
): { draft: string; caret: number } => {
  const next = `${draft.slice(0, tokenStart)}${insertText}${draft.slice(caret)}`;
  const nextCaret = tokenStart + insertText.length;
  return { draft: next, caret: nextCaret };
};

/** True when the typed query already equals the only remaining item (token complete). */
const isExactCompletedToken = (
  query: string,
  items: Array<{ label: string; insertText: string }>,
): boolean => {
  if (!query || items.length !== 1) return false;
  const only = items[0];
  if (!only) return false;
  const label = only.label.toLowerCase();
  const insertCore = only.insertText.replace(/^~/, "").trim().toLowerCase();
  return query === label || query === insertCore;
};
