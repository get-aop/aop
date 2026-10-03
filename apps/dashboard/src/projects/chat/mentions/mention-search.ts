import type { Thread } from "@aop/common";
import { pullRequestOf } from "../../selectors";

/**
 * Finding a thread to @-mention by what it is about: its title, its pull request, its status line
 * and its description (the start of its brief). Every word typed has to be found somewhere; a
 * word in the title counts most, one at the start of a word more than one inside it, and a title
 * can also match fuzzily (the letters in order). Active threads come before resolved ones.
 * Fields are folded once per thread list, so a search over hundreds of threads stays a few
 * milliseconds.
 */

/** [start, end) in the text it belongs to. */
export type Range = readonly [number, number];

export interface MentionResult {
  thread: Thread;
  score: number;
  titleRanges: readonly Range[];
  /** One line to tell the thread by: where the words were found, else the start of its brief. */
  snippet: { text: string; ranges: readonly Range[] } | null;
}

export interface MentionIndex {
  entries: readonly IndexEntry[];
}

export const MENTION_RESULTS_MAX = 50;

const SNIPPET_BEFORE = 40;
const SNIPPET_LENGTH = 200;

interface Field {
  text: string;
  folded: string;
}

interface IndexEntry {
  thread: Thread;
  resolved: boolean;
  title: Field;
  pullRequest: string | null;
  statusLine: Field | null;
  description: Field | null;
}

type FieldName = "title" | "statusLine" | "description";

// How much a word found in each field counts: at the start of a word, and inside one.
const WEIGHT: Record<FieldName, { wordStart: number; inside: number }> = {
  title: { wordStart: 10, inside: 6 },
  statusLine: { wordStart: 4, inside: 2 },
  description: { wordStart: 3, inside: 1.5 },
};
const WHOLE_WORD_BONUS = 1.5;
const PULL_REQUEST_SCORE = 10;
const PHRASE_IN_TITLE_BONUS = 5;

export const buildMentionIndex = (threads: readonly Thread[]): MentionIndex => ({
  entries: threads.map((thread) => ({
    thread,
    resolved: thread.status === "resolved",
    title: field(thread.title),
    pullRequest: pullRequestNumberOf(thread),
    statusLine: thread.liveStatusLine ? field(thread.liveStatusLine) : null,
    description: thread.description ? field(thread.description) : null,
  })),
});

/** The threads that match `query`, best first, active before resolved; all of them for none. */
export const searchMentions = (
  index: MentionIndex,
  query: string,
  limit = MENTION_RESULTS_MAX,
): MentionResult[] => {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const results = index.entries.flatMap((entry) => {
    const result = words.length === 0 ? unranked(entry) : ranked(entry, words);
    return result ? [{ result, resolved: entry.resolved }] : [];
  });
  results.sort(
    (a, b) =>
      Number(a.resolved) - Number(b.resolved) ||
      b.result.score - a.result.score ||
      b.result.thread.lastActivityAt.localeCompare(a.result.thread.lastActivityAt),
  );
  return results.slice(0, limit).map(({ result }) => result);
};

const unranked = (entry: IndexEntry): MentionResult => ({
  thread: entry.thread,
  score: 0,
  titleRanges: [],
  snippet: leadSnippet(entry),
});

const ranked = (entry: IndexEntry, words: readonly string[]): MentionResult | null => {
  let score = 0;
  const titleRanges: Range[] = [];
  for (const word of words) {
    const best = bestMatch(entry, word);
    if (best === null) return null;
    score += best.score;
    titleRanges.push(...best.titleRanges);
  }
  const phrase = words.length > 1 && entry.title.folded.includes(words.join(" "));
  return {
    thread: entry.thread,
    score: score + (phrase ? PHRASE_IN_TITLE_BONUS : 0),
    titleRanges: merge(titleRanges),
    snippet: matchSnippet(entry, words) ?? leadSnippet(entry),
  };
};

// The brief first: it says what the thread is about, which is what the snippet is for.
const SNIPPET_FIELDS = ["description", "statusLine"] as const;

/** Where one word counts most for a thread, and the letters of the title it lights up. */
const bestMatch = (
  entry: IndexEntry,
  word: string,
): { score: number; titleRanges: Range[] } | null => {
  const candidates = [
    pullRequestMatch(entry.pullRequest, word),
    titleMatch(entry.title, word),
    ...SNIPPET_FIELDS.map((name) => {
      const match = entry[name] ? wordMatch(entry[name], word) : null;
      return match ? { score: scoreOf(name, match), titleRanges: [] } : null;
    }),
  ].filter((candidate) => candidate !== null);
  if (candidates.length === 0) return null;
  return candidates.reduce((best, next) => (next.score > best.score ? next : best));
};

// "12" or "#12" finds pull request 12, and 120 a little less.
const pullRequestMatch = (pullRequest: string | null, word: string) => {
  const number = word.replace(/^#/, "");
  if (!pullRequest || !/^\d+$/.test(number) || !pullRequest.startsWith(number)) return null;
  return { score: PULL_REQUEST_SCORE * (pullRequest === number ? 1 : 0.8), titleRanges: [] };
};

const titleMatch = (title: Field, word: string) => {
  const match = wordMatch(title, word);
  if (!match) return fuzzyMatch(title.folded, word);
  return { score: scoreOf("title", match), titleRanges: [match.range] };
};

interface WordMatch {
  range: Range;
  wordStart: boolean;
  wholeWord: boolean;
}

// The first place the word starts a word, else the first place it appears at all.
const wordMatch = (field: Field, word: string): WordMatch | null => {
  let first: number | null = null;
  for (let at = field.folded.indexOf(word); at >= 0; at = field.folded.indexOf(word, at + 1)) {
    first ??= at;
    if (isWordStart(field.folded, at)) {
      const end = at + word.length;
      return { range: [at, end], wordStart: true, wholeWord: !isWordChar(field.folded[end]) };
    }
  }
  return first === null
    ? null
    : { range: [first, first + word.length], wordStart: false, wholeWord: false };
};

const scoreOf = (name: FieldName, match: WordMatch): number =>
  (match.wordStart ? WEIGHT[name].wordStart : WEIGHT[name].inside) *
  (match.wholeWord ? WHOLE_WORD_BONUS : 1);

/**
 * The word's letters in order in the title ("lgn" in "Fix login"), close enough together to be
 * meant. Runs of letters next to each other count more, so a near-miss of a typo ranks above
 * letters scattered across the title.
 */
const fuzzyMatch = (
  title: string,
  word: string,
): { score: number; titleRanges: Range[] } | null => {
  if (word.length < 2) return null;
  const ranges: [number, number][] = [];
  let at = 0;
  let first = 0;
  for (const char of word) {
    const next = title.indexOf(char, at);
    if (next < 0) return null;
    const last = ranges.at(-1);
    if (last && last[1] === next) last[1] = next + 1;
    else ranges.push([next, next + 1]);
    if (ranges.length === 1) first = next;
    at = next + 1;
  }
  if (at - first > word.length * 3) return null;
  const together = word.length - ranges.length + 1;
  return { score: 1 + (3 * together) / word.length, titleRanges: ranges };
};

/** The line where the words were found. */
const matchSnippet = (entry: IndexEntry, words: readonly string[]): MentionResult["snippet"] => {
  for (const name of SNIPPET_FIELDS) {
    const source = entry[name];
    if (!source) continue;
    const ranges = merge(
      words.flatMap((word) => {
        const match = wordMatch(source, word);
        return match ? [match.range] : [];
      }),
    );
    const first = ranges[0];
    if (first) return around(source.text, ranges, first[0]);
  }
  return null;
};

// What the thread was asked, or else what it is doing.
const leadSnippet = (entry: IndexEntry): MentionResult["snippet"] => {
  const text = entry.description?.text ?? entry.statusLine?.text;
  return text ? { text: text.slice(0, SNIPPET_LENGTH), ranges: [] } : null;
};

// A stretch of `text` that starts a little before `at`, with the ranges moved to fit it.
const around = (text: string, ranges: readonly Range[], at: number) => {
  const start = at <= SNIPPET_BEFORE ? 0 : wordStartAfter(text, at - SNIPPET_BEFORE, at);
  const lead = start > 0 ? "…" : "";
  const offset = lead.length - start;
  const end = start + SNIPPET_LENGTH;
  return {
    text: lead + text.slice(start, end),
    ranges: ranges
      .filter(([from, to]) => from >= start && to <= end)
      .map(([from, to]): Range => [from + offset, to + offset]),
  };
};

// Where the first word that starts in [from, to] begins, so a snippet never opens mid-word.
const wordStartAfter = (text: string, from: number, to: number): number => {
  for (let at = from; at < to; at += 1) {
    if (isWordChar(text[at]) && !isWordChar(text[at - 1])) return at;
  }
  return to;
};

const merge = (ranges: readonly Range[]): Range[] => {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [from, to] of sorted) {
    const last = merged.at(-1);
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else merged.push([from, to]);
  }
  return merged;
};

const field = (text: string): Field => ({ text, folded: fold(text) });

/**
 * Lower case without accents, one character for one, so a place found in the folded text is the
 * same place in the text as written.
 */
export const fold = (text: string): string => {
  if (/^\p{ASCII}*$/u.test(text)) return text.toLowerCase();
  let folded = "";
  for (const char of text) {
    const plain = char.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    folded += plain.length === char.length ? plain : char.toLowerCase().slice(0, char.length);
  }
  return folded;
};

const isWordChar = (char: string | undefined): boolean =>
  char !== undefined && /[\p{L}\p{N}]/u.test(char);

const isWordStart = (text: string, at: number): boolean => {
  if (!isWordChar(text[at - 1])) return true;
  // A number right after letters ("v2", "pr12") starts a word too.
  return /\d/.test(text[at] ?? "") && !/\d/.test(text[at - 1] ?? "");
};

const pullRequestNumberOf = (thread: Thread): string | null => {
  const pullRequest = pullRequestOf(thread);
  return pullRequest ? String(pullRequest.number) : null;
};
