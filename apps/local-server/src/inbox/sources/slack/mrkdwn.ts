/**
 * Slack's message markup, read for the Inbox: which mentions a message carries (the facts the
 * rules need) and the message as plain text, with people, channels and groups named and links
 * kept. https://docs.slack.dev/messaging/formatting-message-text
 */

export interface MentionFacts {
  /** User ids mentioned with `<@U…>`. */
  users: string[];
  /** Group ids mentioned with `<!subteam^S…>`. */
  groups: string[];
  /** `<!here>`, `<!channel>` or `<!everyone>`. */
  broadcast: boolean;
}

export const mentionFacts = (text: string): MentionFacts => {
  const users = new Set<string>();
  const groups = new Set<string>();
  let broadcast = false;
  for (const [, inner = ""] of text.matchAll(ENTITY)) {
    const [target = ""] = inner.split("|");
    if (target.startsWith("@")) users.add(target.slice(1));
    else if (target.startsWith("!subteam^")) groups.add(target.slice("!subteam^".length));
    else if (BROADCASTS.has(target)) broadcast = true;
  }
  return { users: [...users], groups: [...groups], broadcast };
};

/** The ids a message names, so their names can be looked up before it is rendered. */
export const userIdsIn = (text: string): string[] => mentionFacts(text).users;

/**
 * The message as plain text: `<@U1>` becomes `@Priya Rao` (or `@U1` when the name is unknown),
 * `<#C1|infra>` becomes `#infra`, `<!subteam^S1|@platform>` `@platform`, `<!here>` `@here`,
 * `<https://x|label>` `label (https://x)`, and Slack's three escapes are undone.
 */
export const renderMrkdwn = (text: string, userName: (id: string) => string | null): string =>
  text
    .replace(ENTITY, (_match, inner: string) => renderEntity(inner, userName))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

const ENTITY = /<([^<>\s][^<>]*)>/g;
const BROADCASTS = new Set(["!here", "!channel", "!everyone"]);

const renderEntity = (inner: string, userName: (id: string) => string | null): string => {
  const bar = inner.indexOf("|");
  const target = bar === -1 ? inner : inner.slice(0, bar);
  const label = bar === -1 ? null : inner.slice(bar + 1);
  const render = ENTITY_RENDERERS.find(([prefix]) => target.startsWith(prefix))?.[1];
  if (render) return render(target, label, userName);
  return label && label !== target ? `${label} (${target})` : target;
};

type EntityRenderer = (
  target: string,
  label: string | null,
  userName: (id: string) => string | null,
) => string;

// Checked in order: `!subteam^` and `!date^` before the other `!` specials.
const ENTITY_RENDERERS: Array<[string, EntityRenderer]> = [
  ["@", (target, label, userName) => `@${label ?? userName(target.slice(1)) ?? target.slice(1)}`],
  ["#", (target, label) => `#${label ?? target.slice(1)}`],
  ["!subteam^", (_target, label) => label ?? "@group"],
  ["!date^", (_target, label) => label ?? "a date"],
  ["!", (target) => `@${target.slice(1)}`],
  ["mailto:", (target, label) => label ?? target.slice("mailto:".length)],
];
