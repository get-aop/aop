import { createContext, useContext } from "react";

/**
 * Links a reply makes to artifacts and files. The markdown parser drops schemes it does not know,
 * and the sanitizer may drop paths, so both are rewritten to addresses it keeps, which the
 * renderer recognizes and the host never resolves (as thread chips are, in inline-run):
 *
 * - `[Plan](artifact:<id>)`: an artifact, drawn as a pill that opens it.
 * - `[plan](docs/plan.md)` or an absolute path: a file in the chat's workspace, opened in the
 *   artifact view. Only something that looks like a file (it has an extension) counts.
 */
const ARTIFACT_PREFIX = "https://artifact.aop.invalid/";
const FILE_PREFIX = "https://file.aop.invalid/";

const LINK_TARGET = /\]\(([^()\s]+)\)/g;

// Code is shown as written: fences and inline code are left alone.
const CODE = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`)/g;

export const withArtifactLinks = (markdown: string): string =>
  markdown.includes("](")
    ? markdown
        .split(CODE)
        .map((part, index) =>
          index % 2 === 1
            ? part
            : part.replace(LINK_TARGET, (link, target: string) => rewrite(link, target)),
        )
        .join("")
    : markdown;

const rewrite = (link: string, target: string): string => {
  if (target.startsWith("artifact:")) {
    const id = target.slice("artifact:".length);
    return /^[A-Za-z0-9_-]+$/.test(id) ? `](${ARTIFACT_PREFIX}${id})` : link;
  }
  const path = workspacePathOf(target);
  return path ? `](${FILE_PREFIX}${encodeURIComponent(path)})` : link;
};

// A path, relative or absolute (or a file: URL), whose last segment has an extension.
const workspacePathOf = (target: string): string | null => {
  const path = target.startsWith("file://") ? target.slice("file://".length) : target;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("#") || path.startsWith("//"))
    return null;
  const clean = path.split(/[?#]/, 1)[0] ?? "";
  const name = clean.split("/").pop() ?? "";
  return /\.[A-Za-z0-9]{1,8}$/.test(name) ? safeDecode(clean) : null;
};

const safeDecode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export const artifactLinkOf = (href: string | undefined): string | null =>
  href?.startsWith(ARTIFACT_PREFIX) ? href.slice(ARTIFACT_PREFIX.length) || null : null;

export const fileLinkOf = (href: string | undefined): string | null =>
  href?.startsWith(FILE_PREFIX) ? safeDecode(href.slice(FILE_PREFIX.length)) || null : null;

/** Whose workspace a reply's file links are in: a thread's, or the coordinator's (null). */
export const ChatOriginContext = createContext<{ threadId: string | null }>({ threadId: null });

export const useChatOrigin = () => useContext(ChatOriginContext);
