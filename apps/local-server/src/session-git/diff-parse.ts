import type { SessionDiffFile, SessionDiffHunk } from "@aop/common";

interface DiffParseState {
  files: SessionDiffFile[];
  current: SessionDiffFile | null;
  hunk: SessionDiffHunk | null;
  oldNo: number;
  newNo: number;
}

export const parseUnifiedDiff = (raw: string): SessionDiffFile[] => {
  const state: DiffParseState = {
    files: [],
    current: null,
    hunk: null,
    oldNo: 0,
    newNo: 0,
  };
  for (const line of raw.split("\n")) {
    applyDiffLine(state, line);
  }
  if (state.current) state.files.push(state.current);
  return state.files;
};

const applyDiffLine = (state: DiffParseState, line: string): void => {
  if (line.startsWith("diff --git ")) {
    beginDiffFile(state, line);
    return;
  }
  if (!state.current) return;
  // Git emits ---/+++/mode/rename headers only between `diff --git` and the first
  // `@@`. Inside a hunk, lines may legitimately begin with `-- ` or `++ `.
  if (state.hunk === null && applyFileHeaderLine(state.current, line)) return;
  if (line.startsWith("@@")) {
    beginHunk(state, line);
    return;
  }
  if (!state.hunk) return;
  applyHunkBodyLine(state, line);
};

const beginDiffFile = (state: DiffParseState, line: string): void => {
  if (state.current) state.files.push(state.current);
  const paths = parseDiffGitPaths(line);
  state.current = {
    path: paths?.newPath ?? "",
    oldPath: null,
    status: "modified",
    additions: 0,
    deletions: 0,
    truncated: false,
    hunks: [],
  };
  state.hunk = null;
};

/**
 * Paths from a `diff --git` line. Handles both the plain `a/x b/y` form and
 * git's C-style quoting for non-ASCII paths (`"a/caf\303\251"`).
 */
const parseDiffGitPaths = (line: string): { oldPath: string; newPath: string } | null => {
  const rest = line.slice("diff --git ".length);
  const tokens = rest.match(/"(?:[^"\\]|\\.)*"|\S+/g);
  if (!tokens || tokens.length < 2) return null;
  const oldPath = parseGitPathToken(tokens[0] ?? "", "a/");
  const newPath = parseGitPathToken(tokens[1] ?? "", "b/");
  return oldPath === null || newPath === null ? null : { oldPath, newPath };
};

const parseGitPathToken = (token: string, prefix: string): string | null => {
  const value = token.startsWith('"') ? unquoteCStylePath(token) : token;
  return value.startsWith(prefix) ? value.slice(prefix.length) : null;
};

/** Decodes git's C-style quoted path (octal escapes for non-ASCII UTF-8 bytes). */
const unquoteCStylePath = (token: string): string => {
  if (token.length < 2 || !token.startsWith('"') || !token.endsWith('"')) return token;
  const body = token.slice(1, -1);
  const bytes: number[] = [];
  let index = 0;
  while (index < body.length) {
    const char = body[index] ?? "";
    if (char === "\\") {
      index = consumeCStyleEscape(body, index, bytes);
      continue;
    }
    pushCharBytes(bytes, char);
    index += 1;
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
};

const pushCharBytes = (bytes: number[], char: string): void => {
  for (const byte of new TextEncoder().encode(char)) bytes.push(byte);
};

const SIMPLE_ESCAPES: Record<string, string> = {
  "\\": "\\",
  '"': '"',
  n: "\n",
  t: "\t",
  r: "\r",
};

/** Consumes one `\x` sequence at `index`; returns the next unread index. */
const consumeCStyleEscape = (body: string, index: number, bytes: number[]): number => {
  const next = body[index + 1] ?? "";
  if (next >= "0" && next <= "7") {
    bytes.push(Number.parseInt(body.slice(index + 1, index + 4), 8));
    return index + 4;
  }
  pushCharBytes(bytes, SIMPLE_ESCAPES[next] ?? next);
  return index + 2;
};

const applyFileHeaderLine = (current: SessionDiffFile, line: string): boolean => {
  if (line.startsWith("new file mode")) {
    current.status = "added";
    return true;
  }
  if (line.startsWith("deleted file mode")) {
    current.status = "deleted";
    return true;
  }
  if (applyRenameHeader(current, line)) return true;
  if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
    current.status = "binary";
    return true;
  }
  return applyPathHeader(current, line);
};

const applyRenameHeader = (current: SessionDiffFile, line: string): boolean => {
  if (line.startsWith("rename from ")) {
    current.status = "renamed";
    current.oldPath = unquoteMaybeQuoted(line.slice("rename from ".length));
    return true;
  }
  if (line.startsWith("rename to ")) {
    current.path = unquoteMaybeQuoted(line.slice("rename to ".length));
    return true;
  }
  return false;
};

const unquoteMaybeQuoted = (value: string): string =>
  value.startsWith('"') ? unquoteCStylePath(value) : value;

const applyPathHeader = (current: SessionDiffFile, line: string): boolean => {
  if (line.startsWith("--- ")) {
    const oldPath = parseGitPathToken(line.slice(4).trim(), "a/");
    if (oldPath !== null) current.oldPath = oldPath;
    return true;
  }
  if (line.startsWith("+++ ")) {
    const newPath = parseGitPathToken(line.slice(4).trim(), "b/");
    if (newPath !== null) current.path = newPath;
    return true;
  }
  return false;
};

const beginHunk = (state: DiffParseState, line: string): void => {
  if (!state.current) return;
  const header = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  state.oldNo = header ? Number.parseInt(header[1] ?? "0", 10) : 0;
  state.newNo = header ? Number.parseInt(header[2] ?? "0", 10) : 0;
  state.hunk = { oldStart: state.oldNo, newStart: state.newNo, lines: [] };
  state.current.hunks.push(state.hunk);
};

const applyHunkBodyLine = (state: DiffParseState, line: string): void => {
  const hunk = state.hunk;
  const current = state.current;
  if (!hunk || !current) return;

  if (line.startsWith("+")) {
    hunk.lines.push({ type: "add", oldNo: null, newNo: state.newNo, text: line.slice(1) });
    current.additions += 1;
    state.newNo += 1;
    return;
  }
  if (line.startsWith("-")) {
    hunk.lines.push({ type: "del", oldNo: state.oldNo, newNo: null, text: line.slice(1) });
    current.deletions += 1;
    state.oldNo += 1;
    return;
  }
  if (line.startsWith(" ")) {
    hunk.lines.push({
      type: "context",
      oldNo: state.oldNo,
      newNo: state.newNo,
      text: line.slice(1),
    });
    state.oldNo += 1;
    state.newNo += 1;
  }
};
