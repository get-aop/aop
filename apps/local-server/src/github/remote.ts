/**
 * The `owner/name` of a github.com remote url, in any of the shapes git keeps one in
 * (`https://github.com/o/r.git`, `git@github.com:o/r.git`, `ssh://git@github.com/o/r`), or null
 * for a remote that is not on github.com.
 */
export const githubNameWithOwner = (remoteUrl: string): string | null => {
  const match = remoteUrl
    .trim()
    .match(
      /^(?:(?:https?|ssh|git):\/\/(?:[^@/]+@)?github\.com(?::\d+)?\/|[^@\s]+@github\.com:)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i,
    );
  return match ? `${match[1]}/${match[2]}` : null;
};
