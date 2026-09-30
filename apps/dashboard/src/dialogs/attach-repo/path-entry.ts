/*
 * The Attach repository dialog lets a person type a path. These functions read what they typed:
 * which folder to list (`dir`) and which part of a name they have typed so far (`fragment`).
 * The host resolves `~` and `..` itself, so they stay as typed.
 */

export interface TypedPath {
  /** The folder whose subfolders the typed text chooses among. */
  dir: string;
  /** What has been typed of the subfolder's name: everything after the last `/`. */
  fragment: string;
}

export const splitTypedPath = (draft: string, currentPath: string): TypedPath => {
  const absolute = absolutize(draft, currentPath);
  if (absolute === "~") return { dir: "~", fragment: "" };
  const slash = absolute.lastIndexOf("/");
  return {
    dir: slash === 0 ? "/" : absolute.slice(0, slash),
    fragment: absolute.slice(slash + 1),
  };
};

/** The folder Enter goes to: the typed text as a path, without a trailing slash. */
export const typedFolder = (draft: string, currentPath: string): string => {
  const absolute = absolutize(draft, currentPath);
  return absolute.length > 1 ? absolute.replace(/\/+$/, "") || "/" : absolute;
};

/** The subfolders whose names begin with what was typed, in any case. */
export const matchingFolders = (names: string[], fragment: string): string[] => {
  const prefix = fragment.toLowerCase();
  return prefix ? names.filter((name) => name.toLowerCase().startsWith(prefix)) : names;
};

export const joinPath = (dir: string, name: string): string =>
  dir === "/" ? `/${name}` : `${dir}/${name}`;

// Text that does not start at the root or the home folder is a path below the folder on show.
const absolutize = (draft: string, currentPath: string): string => {
  if (draft.startsWith("/") || draft === "~" || draft.startsWith("~/")) return draft;
  return draft ? joinPath(currentPath, draft) : `${currentPath}/`;
};
