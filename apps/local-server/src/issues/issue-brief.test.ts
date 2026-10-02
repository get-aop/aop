import { describe, expect, test } from "bun:test";
import { ISSUE_BRIEF_BODY_MAX, issueBrief } from "./issue-brief.ts";

const issue = {
  source: "github" as const,
  reference: "acme/app#12",
  title: "Fix the flaky test",
  url: "https://github.com/acme/app/issues/12",
  body: "Steps:\n1. Run it",
};

describe("issueBrief", () => {
  test("asks for a thread with the issue's reference, title, link and body, in plain text", () => {
    expect(issueBrief(issue)).toBe(
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
    expect(issueBrief({ ...issue, source: "linear", body: "  " })).toContain(
      "(The issue has no description.)",
    );
    expect(issueBrief({ ...issue, source: "linear", body: "  " })).toContain("this Linear issue");
    const long = issueBrief({ ...issue, body: "x".repeat(ISSUE_BRIEF_BODY_MAX + 50) });
    expect(long).toContain("[…the rest is at the link]");
    expect(long.length).toBeLessThan(ISSUE_BRIEF_BODY_MAX + 400);
  });
});
