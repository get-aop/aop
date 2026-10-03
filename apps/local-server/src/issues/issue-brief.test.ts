import { describe, expect, test } from "bun:test";
import type { IssueDetail } from "@aop/common";
import { ISSUE_BRIEF_BODY_MAX, issueBrief } from "./issue-brief.ts";
import { projectIssue } from "./test-utils.ts";

const detail = (overrides: Partial<IssueDetail> = {}): IssueDetail => ({
  issue: projectIssue(),
  body: "Steps:\n1. Run it",
  sections: [],
  comments: [],
  commentCount: 0,
  ...overrides,
});

describe("issueBrief", () => {
  test("asks for a thread with the issue's reference, title, link and body, in plain text", () => {
    expect(issueBrief(detail())).toBe(
      [
        "Start a thread to work on this GitHub issue. Use its title, description and link as the brief.",
        "",
        "acme/app#12: Fix the flaky test",
        "https://github.com/acme/app/issues/12",
        "",
        "The issue's description, as written on the issue:",
        "<<< issue description",
        "Steps:\n1. Run it",
        "issue description >>>",
      ].join("\n"),
    );
  });

  test("an empty body says so, and a long one is cut with a pointer to the link", () => {
    const linear = projectIssue({ source: "linear", identifier: "ENG-7", container: "Eng" });
    expect(issueBrief(detail({ issue: linear, body: "  " }))).toContain(
      "(The issue has no description.)",
    );
    expect(issueBrief(detail({ issue: linear, body: "  " }))).toContain("this Linear issue. Use");
    expect(issueBrief(detail({ issue: linear }))).toContain("\nENG-7: Fix the flaky test\n");
    const long = issueBrief(detail({ body: "x".repeat(ISSUE_BRIEF_BODY_MAX + 50) }));
    expect(long).toContain("[…the rest is at the link]");
    expect(long.length).toBeLessThan(ISSUE_BRIEF_BODY_MAX + 400);
  });

  test("a Jira issue brings its key, acceptance criteria and, when asked, the pull request's key", () => {
    const jira = projectIssue({
      source: "jira",
      identifier: "APP-3",
      container: "Mobile App",
      url: "https://acme.atlassian.net/browse/APP-3",
    });
    const sections = [{ title: "Acceptance criteria", body: "- It signs in" }];
    const brief = issueBrief(detail({ issue: jira, sections }), { keyInPullRequest: true });
    expect(brief).toContain("this Jira issue. Use");
    expect(brief).toContain(
      "\nAPP-3: Fix the flaky test\nhttps://acme.atlassian.net/browse/APP-3\n",
    );
    expect(brief).toContain(
      "Its acceptance criteria, as written on the issue:\n<<< acceptance criteria\n- It signs in\nacceptance criteria >>>",
    );
    expect(
      brief.endsWith("start its title with APP-3 so Jira links the pull request to the issue."),
    ).toBe(true);
    expect(issueBrief(detail({ issue: jira }))).not.toContain("pull request");
  });
});
