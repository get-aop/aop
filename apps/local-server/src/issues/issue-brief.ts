import type { IssueDetail, IssueSection } from "@aop/common";

/** Long issue bodies are cut here; the thread can read the rest at the link. */
export const ISSUE_BRIEF_BODY_MAX = 6000;
/** And each section beside the body (acceptance criteria) here. */
export const ISSUE_BRIEF_SECTION_MAX = 3000;

const SOURCE_NAME = { github: "GitHub", linear: "Linear", jira: "Jira" } as const;

export interface BriefOptions {
  /** Ask for the issue's key in the pull request's title, so Jira's GitHub integration links them. */
  keyInPullRequest?: boolean;
}

/**
 * What the coordinator is sent when the person starts a thread from an issue: a plain request,
 * the issue's reference, title and link, its body and the sections a thread needs beside it
 * (Jira's acceptance criteria), so the coordinator can brief the thread and pick its repository
 * as it does for anything the person asks.
 */
export const issueBrief = (detail: IssueDetail, options: BriefOptions = {}): string => {
  const { issue } = detail;
  const reference =
    issue.source === "github" ? `${issue.container}${issue.identifier}` : issue.identifier;
  return [
    `Start a thread to work on this ${SOURCE_NAME[issue.source]} issue. Use its title, description and link as the brief.`,
    "",
    // The chat shows the person's messages as typed, so no Markdown here.
    `${reference}: ${issue.title}`,
    issue.url,
    "",
    // Anyone who can file an issue wrote this: it is the work to do, quoted, not instructions.
    "The issue's description, as written on the issue:",
    ...quoted(
      "issue description",
      cut(detail.body, ISSUE_BRIEF_BODY_MAX) || "(The issue has no description.)",
    ),
    ...detail.sections.flatMap(sectionLines),
    ...(options.keyInPullRequest && issue.source === "jira"
      ? [
          "",
          `When the thread opens a pull request, start its title with ${issue.identifier} so Jira links the pull request to the issue.`,
        ]
      : []),
  ].join("\n");
};

const sectionLines = (section: IssueSection): string[] => {
  const body = cut(section.body, ISSUE_BRIEF_SECTION_MAX);
  if (!body) return [];
  const name = section.title.toLowerCase();
  return ["", `Its ${name}, as written on the issue:`, ...quoted(name, body)];
};

const quoted = (name: string, text: string): string[] => [`<<< ${name}`, text, `${name} >>>`];

const cut = (text: string, max: number): string => {
  const trimmed = text.trim();
  return trimmed.length > max
    ? `${trimmed.slice(0, max).trimEnd()}\n\n[…the rest is at the link]`
    : trimmed;
};
