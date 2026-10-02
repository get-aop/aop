import type { IssueWithBody } from "./issue-body.ts";

/** Long issue bodies are cut here; the thread can read the rest at the link. */
export const ISSUE_BRIEF_BODY_MAX = 6000;

const SOURCE_NAME = { github: "GitHub", linear: "Linear" } as const;

/**
 * What the coordinator is sent when the person starts a thread from an issue: a plain request,
 * the issue's title and link, and its body, so the coordinator can brief the thread and pick
 * its repository as it does for anything the person asks.
 */
export const issueBrief = (issue: IssueWithBody): string => {
  const body = issue.body.trim();
  const cut = body.length > ISSUE_BRIEF_BODY_MAX;
  const shown = cut
    ? `${body.slice(0, ISSUE_BRIEF_BODY_MAX).trimEnd()}\n\n[…the rest is at the link]`
    : body;
  return [
    `Start a thread to work on this ${SOURCE_NAME[issue.source]} issue. Use its title, description and link as the brief.`,
    "",
    // The chat shows the person's messages as typed, so no Markdown here.
    `${issue.reference}: ${issue.title}`,
    issue.url,
    "",
    shown || "(The issue has no description.)",
  ].join("\n");
};
