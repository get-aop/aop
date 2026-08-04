export interface MarkdownFileRef {
  path: string;
  fileName: string;
  dir: string;
}

const MAX_REFS = 4;
const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:\//;
const WEB_URL = /^[A-Za-z][A-Za-z\d+.-]*:\/\//;
const REFERENCE_PATTERN = /\[[^\]]*\]\(\s*([^\s)]+)|(`[^`]+`)|([^\s]+)/g;

export const resolveMarkdownFilePath = (
  candidate: string,
  repoPath: string | null,
): string | null => resolveReference(candidate, repoPath);

export const extractMarkdownFileRefs = (
  content: string,
  repoPath: string | null,
): MarkdownFileRef[] => {
  const refs: MarkdownFileRef[] = [];
  const seen = new Set<string>();

  for (const match of content.matchAll(REFERENCE_PATTERN)) {
    const candidate = cleanReference(match[1] ?? match[2] ?? match[3] ?? "");
    if (match[2] && /\s/.test(candidate) && !isExplicitPath(candidate)) continue;
    const resolved = resolveReference(candidate, repoPath);
    if (!resolved || seen.has(resolved)) continue;

    seen.add(resolved);
    refs.push(createFileRef(resolved, repoPath));
    if (refs.length === MAX_REFS) break;
  }

  return refs;
};

export const resolveMarkdownFileRefs = (
  content: string,
  repoPath: string | null,
  artifactPaths: string[] = [],
): MarkdownFileRef[] => {
  const refs: MarkdownFileRef[] = [];
  const seen = new Set<string>();
  const addRef = (path: string) => {
    if (seen.has(path) || refs.length === MAX_REFS) return;
    seen.add(path);
    refs.push(createFileRef(path, repoPath));
  };

  for (const artifactPath of artifactPaths) {
    const resolved = resolveReference(artifactPath, repoPath);
    if (resolved) addRef(resolved);
  }
  for (const ref of extractMarkdownFileRefs(content, repoPath)) addRef(ref.path);
  return refs;
};

const cleanReference = (value: string): string => value.replace(/^[`([<{]+|[)`\]}>.,;:!?]+$/g, "");

const isExplicitPath = (value: string): boolean =>
  value.startsWith("/") ||
  value.startsWith("~/") ||
  value.startsWith("./") ||
  value.startsWith("../") ||
  WINDOWS_ABSOLUTE_PATH.test(normalizeSeparators(value));

const resolveReference = (candidate: string, repoPath: string | null): string | null => {
  if (!candidate?.toLowerCase().endsWith(".md") || WEB_URL.test(candidate)) {
    return null;
  }

  if (candidate.startsWith("~/")) {
    const home = getHomeDirectory(repoPath);
    return home ? normalizePath(`${home}/${candidate.slice(2)}`) : candidate;
  }

  if (!isAbsolutePath(candidate) && !repoPath) return null;
  return normalizePath(candidate, repoPath ?? undefined);
};

const createFileRef = (filePath: string, repoPath: string | null): MarkdownFileRef => {
  const basePath = repoPath ?? getDirectoryName(filePath);
  const relativePath = isAbsolutePath(filePath) ? getRelativePath(basePath, filePath) : filePath;

  return {
    path: filePath,
    fileName: getBaseName(filePath),
    dir: getDirectoryName(relativePath),
  };
};

const getHomeDirectory = (repoPath: string | null): string | null => {
  const runtime = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  };
  const configuredHome = runtime.process?.env?.HOME ?? runtime.process?.env?.USERPROFILE;
  if (configuredHome) return configuredHome;

  const normalizedRepoPath = repoPath ? normalizeSeparators(repoPath) : "";
  const homeMatch = normalizedRepoPath.match(/^(\/(?:Users|home)\/[^/]+)/i);
  return homeMatch?.[1] ?? normalizedRepoPath.match(/^([A-Za-z]:\/Users\/[^/]+)/i)?.[1] ?? null;
};

const isAbsolutePath = (value: string): boolean =>
  value.startsWith("/") || WINDOWS_ABSOLUTE_PATH.test(normalizeSeparators(value));

const normalizePath = (value: string, basePath?: string): string => {
  const normalizedValue = normalizeSeparators(value);
  const combined = combinePath(normalizedValue, basePath);
  const root = getPathRoot(combined);
  return `${root}${normalizeSegments(combined.slice(root.length))}` || ".";
};

const combinePath = (value: string, basePath?: string): string =>
  isAbsolutePath(value) ? value : `${normalizeSeparators(basePath ?? "")}/${value}`;

const normalizeSegments = (value: string): string => {
  const segments: string[] = [];
  for (const segment of value.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment !== "..") {
      segments.push(segment);
      continue;
    }
    const previous = segments.at(-1);
    if (previous && previous !== "..") segments.pop();
  }
  return segments.join("/");
};

const normalizeSeparators = (value: string): string => value.replaceAll("\\", "/");

const getPathRoot = (value: string): string => {
  if (value.startsWith("/")) return "/";
  if (WINDOWS_ABSOLUTE_PATH.test(value)) return value.slice(0, 3);
  return "";
};

const getBaseName = (value: string): string => {
  const normalized = normalizeSeparators(value).replace(/\/$/, "");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
};

const getDirectoryName = (value: string): string => {
  const normalized = normalizeSeparators(value).replace(/\/$/, "");
  const separator = normalized.lastIndexOf("/");
  return separator < 0 ? "." : normalized.slice(0, separator) || "/";
};

const getRelativePath = (from: string, to: string): string => {
  const normalizedFrom = normalizePath(from);
  const normalizedTo = normalizePath(to);
  const fromParts = normalizedFrom.split("/").filter(Boolean);
  const toParts = normalizedTo.split("/").filter(Boolean);
  let commonLength = 0;

  while (
    commonLength < Math.min(fromParts.length, toParts.length) &&
    fromParts[commonLength] === toParts[commonLength]
  ) {
    commonLength += 1;
  }

  return (
    [...fromParts.slice(commonLength).map(() => ".."), ...toParts.slice(commonLength)].join("/") ||
    "."
  );
};
