import { describe, expect, test } from "bun:test";
import { buildJiraIssueSourceText, buildLinearIssueSourceText } from "./source-text.ts";

describe("external issue source text", () => {
  test("buildLinearIssueSourceText includes issue metadata and blockers", () => {
    const text = buildLinearIssueSourceText({
      id: "lin_1",
      ref: "GET-41",
      title: "Dashboard scroll",
      url: "https://linear.app/get-aop/issue/GET-41",
      blocks: [
        {
          id: "lin_2",
          ref: "GET-40",
          title: "Blocker issue",
          url: "https://linear.app/get-aop/issue/GET-40",
        },
      ],
      description: "Fix scrolling in the dashboard shell.",
      priority: 2,
      state: { name: "Todo", type: "unstarted" },
      project: { name: "Dashboard" },
      team: { key: "GET", name: "Get AOP" },
    });

    expect(text).toContain("Provider: Linear");
    expect(text).toContain("Issue ref: GET-41");
    expect(text).toContain("Fix scrolling in the dashboard shell.");
    expect(text).toContain("GET-40");
  });

  test("buildJiraIssueSourceText includes issue metadata and blockers", () => {
    const text = buildJiraIssueSourceText({
      id: "10050",
      key: "GET-50",
      ref: "GET-50",
      title: "Backlog parity",
      url: "https://example.atlassian.net/browse/GET-50",
      blocks: [],
      description: "Match Linear import behavior.",
      priority: { id: "3", name: "Medium" },
      status: { id: "1", name: "To Do", category: "new" },
      project: { id: "1", key: "GET", name: "Get AOP" },
      team: { id: "1", name: "Platform" },
    });

    expect(text).toContain("Provider: Jira");
    expect(text).toContain("Issue ref: GET-50");
    expect(text).toContain("Match Linear import behavior.");
    expect(text).toContain("Project: Get AOP (GET)");
  });
});
