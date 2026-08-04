/** Normalize a free-form title into a short git-safe slug fragment. */
const normalizeSlug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

/**
 * Suggested session worktree branch: `aop/<session-slug>-<short-id>`.
 * Shared by the dashboard popover preview and the local-server create path so
 * the displayed default always matches the server default when omitted.
 */
export const suggestSessionBranchName = (title: string, sessionId: string): string => {
  const slug = normalizeSlug(title) || "session";
  const alnum = sessionId.replace(/[^a-zA-Z0-9]/g, "");
  const shortId = (alnum.slice(-6) || "session").toLowerCase();
  return `aop/${slug}-${shortId}`;
};
