import { ARTIFACT_EXTENSIONS, type ArtifactKind } from "@aop/common";

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  bash: "sh",
  c: "c",
  cpp: "cpp",
  csharp: "cs",
  css: "css",
  diff: "diff",
  go: "go",
  java: "java",
  javascript: "js",
  js: "js",
  jsx: "jsx",
  kotlin: "kt",
  php: "php",
  python: "py",
  py: "py",
  ruby: "rb",
  rust: "rs",
  scss: "scss",
  shell: "sh",
  sh: "sh",
  sql: "sql",
  swift: "swift",
  toml: "toml",
  ts: "ts",
  tsx: "tsx",
  typescript: "ts",
  xml: "xml",
  yaml: "yml",
};

const SLUG_MAX = 60;

/**
 * The Library file name of a new artifact: the agent's own, the file's it saved from a path, or
 * one made from the title with the kind's extension (`Release plan` as markdown is
 * `release-plan.md`).
 */
export const artifactFileName = (input: {
  title: string;
  name?: string;
  path?: string;
  kind?: ArtifactKind;
  language?: string;
}): string => {
  if (input.name?.trim()) return input.name.trim();
  const fromPath = input.path?.split(/[/\\]/).filter(Boolean).pop();
  if (fromPath) return fromPath;
  return `${slugOf(input.title)}.${extensionFor(input.kind ?? "markdown", input.language)}`;
};

const extensionFor = (kind: ArtifactKind, language: string | undefined): string =>
  kind === "code" && language
    ? (LANGUAGE_EXTENSIONS[language.toLowerCase()] ?? ARTIFACT_EXTENSIONS.code)
    : ARTIFACT_EXTENSIONS[kind];

const slugOf = (title: string): string => {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/, "");
  return slug || "artifact";
};
