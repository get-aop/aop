/**
 * Code as a Markdown fence the highlighter renders: a fence one backtick longer than any run of
 * backticks inside, so the code can never close it early.
 */
export const fencedCode = (code: string, language: string | null): string => {
  const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${language ?? ""}\n${code.replace(/\n$/, "")}\n${fence}`;
};
