/**
 * The people in the fake Jira site (fake-jira.ts) and the user objects Jira returns for them.
 * Avatars use the hosts Jira Cloud really points at, so a browser loads them: Atlassian's initials
 * service, Gravatar identicons, and Gravatar with an initials image as its default, which is what
 * Jira sends for someone without a Gravatar. Devon's avatar lives on the site itself and answers
 * 401 the way a private Data Center avatar does to a browser, so the initials fallback shows.
 */

export type JiraApi = "cloud" | "dc";

type AvatarKind =
  | { kind: "initials"; code: string }
  | { kind: "identicon" }
  | { kind: "gravatar-default"; code: string }
  | { kind: "site" };

export interface Person {
  accountId: string;
  /** Data Center identifies people by user name and key instead of an account id. */
  name: string;
  key: string;
  displayName: string;
  email: string;
  timeZone: string;
  avatar: AvatarKind;
}

let userCount = 0;
const person = (
  accountId: string,
  name: string,
  displayName: string,
  avatar: AvatarKind,
  timeZone = "Europe/Lisbon",
): Person => ({
  accountId,
  name,
  key: `JIRAUSER${10100 + ++userCount}`,
  displayName,
  email: `${name}@example.com`,
  timeZone,
  avatar,
});

export const PEOPLE = {
  sam: person("712020:5f1c2a9e-3b7d-4c8e-9a61-2d4b8e0f7c13", "fixture", "Sam Rivera", {
    kind: "initials",
    code: "SR-3",
  }),
  priya: person(
    "5b10ac8d82e05b22cc7d4ef5",
    "priya.natarajan",
    "Priya Natarajan",
    { kind: "identicon" },
    "Asia/Kolkata",
  ),
  marcus: person("712020:0a8e4f62-91c4-4f0b-b3d5-6c2e7a1f9d40", "marcus.klein", "Marcus Klein", {
    kind: "gravatar-default",
    code: "MK-5",
  }),
  lena: person(
    "557058:2c9d6e1a-4f7b-4a3e-8d1c-5e9f0b2a7c66",
    "lena.ortiz",
    "Lena Ortiz",
    { kind: "initials", code: "LO-1" },
    "America/Mexico_City",
  ),
  devon: person("712020:9c3b1d75-6e2f-4a8d-b0c4-1f7e5a9d2b38", "devon.hale", "Devon Hale", {
    kind: "site",
  }),
  tomas: person("63e4f7b2a91c5d0e8f6a2b14", "tomas.berg", "Tomas Berg", { kind: "identicon" }),
} satisfies Record<string, Person>;

/** The token's owner: `assignee = currentUser()` matches them. */
export const ME = PEOPLE.sam;

/** A user as it appears on an issue (assignee, reporter, comment author). */
export function jiraUser(who: Person, base: string, api: JiraApi) {
  const shared = {
    avatarUrls: avatarUrls(who, base),
    displayName: who.displayName,
    active: true,
    timeZone: who.timeZone,
  };
  if (api === "dc") {
    return {
      self: `${base}/rest/api/2/user?username=${who.name}`,
      name: who.name,
      key: who.key,
      emailAddress: who.email,
      ...shared,
    };
  }
  return {
    self: `${base}/rest/api/3/user?accountId=${who.accountId}`,
    accountId: who.accountId,
    accountType: "atlassian",
    ...shared,
  };
}

/** GET /myself: the token's owner, with the email Jira only shows its owner. */
export function myself(base: string, api: JiraApi) {
  return {
    ...jiraUser(ME, base, api),
    emailAddress: "fixture@example.com",
    locale: "en_US",
    groups: { size: 2, items: [] },
    applicationRoles: { size: 1, items: [] },
    expand: "groups,applicationRoles",
  };
}

/** True when `value` names this person the way a JQL user clause can (id, user name or name). */
export function personMatches(who: Person, value: string): boolean {
  const lower = value.toLowerCase();
  return (
    who.accountId === value ||
    who.name === lower ||
    who.key.toLowerCase() === lower ||
    who.displayName.toLowerCase() === lower
  );
}

const SIZES = [48, 24, 16, 32] as const;
const INITIALS_HOST = "https://avatar-management--avatars.us-west-2.prod.public.atl-paas.net";

function avatarUrls(who: Person, base: string): Record<string, string> {
  return Object.fromEntries(SIZES.map((size) => [`${size}x${size}`, avatarUrl(who, base, size)]));
}

function avatarUrl(who: Person, base: string, size: number): string {
  const avatar = who.avatar;
  switch (avatar.kind) {
    case "initials":
      return `${INITIALS_HOST}/initials/${avatar.code}.png?size=${size}&s=${size}`;
    case "identicon":
      return `https://secure.gravatar.com/avatar/${md5(who.email)}?s=${size}&d=identicon`;
    case "gravatar-default":
      return `https://secure.gravatar.com/avatar/${md5(who.email)}?d=${encodeURIComponent(
        `${INITIALS_HOST}/initials/${avatar.code}.png`,
      )}`;
    case "site":
      return `${base}/secure/useravatar?avatarId=10122`;
  }
}

function md5(text: string): string {
  return new Bun.CryptoHasher("md5").update(text.trim().toLowerCase()).digest("hex");
}
