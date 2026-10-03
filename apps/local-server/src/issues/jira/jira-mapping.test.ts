import { describe, expect, test } from "bun:test";
import { ProjectIssueSchema } from "@aop/common";
import { commentsOf, mapJiraIssue, priorityOf, sectionsOf, stageOf } from "./jira-mapping.ts";
import { adfParagraph, cloudCredentials, jiraNode } from "./test-utils.ts";

describe("mapping a Jira issue to a row", () => {
  test("a search result becomes a row the wire accepts", () => {
    const issue = mapJiraIssue(jiraNode(), cloudCredentials());
    expect(ProjectIssueSchema.parse(issue)).toEqual(issue);
    expect(issue).toMatchObject({
      key: "jira:APP-3",
      source: "jira",
      repoId: null,
      container: "Mobile App",
      identifier: "APP-3",
      title: "Sign in with SSO",
      url: "https://acme.atlassian.net/browse/APP-3",
      state: "open",
      stage: "started",
      stateName: "In Progress",
      labels: [
        { name: "auth", color: null },
        { name: "Backend", color: null },
      ],
      assignees: [
        {
          login: "Mia Krystof",
          name: "Mia Krystof",
          avatarUrl: "https://secure.gravatar.com/avatar/abc?s=48",
        },
      ],
      author: { login: "Sam Rivera", name: "Sam Rivera", avatarUrl: null },
      milestone: "2.4.0",
      priority: { name: "High", level: "high" },
      commentCount: null,
      createdAt: "2026-09-20T10:00:00.000Z",
      updatedAt: "2026-09-28T14:03:11.000Z",
    });
  });

  test("the status category decides the group; a done issue resolved as not to do is canceled", () => {
    expect(stageOf("new", null)).toBe("unstarted");
    expect(stageOf("indeterminate", null)).toBe("started");
    expect(stageOf("done", "Done")).toBe("completed");
    expect(stageOf("done", "Won't Do")).toBe("canceled");
    expect(stageOf("done", "Duplicate")).toBe("canceled");
    expect(stageOf("undefined", null)).toBe("unstarted");
    const closed = mapJiraIssue(
      jiraNode("APP-9", {
        status: { name: "Done", statusCategory: { key: "done" } },
        resolution: { name: "Won't Do" },
      }),
      cloudCredentials(),
    );
    expect(closed).toMatchObject({ state: "closed", stage: "canceled", stateName: "Done" });
  });

  test("priorities map by name; a scheme's own names keep their name without a level", () => {
    expect(priorityOf({ name: "Highest" })).toEqual({ name: "Highest", level: "urgent" });
    expect(priorityOf({ name: "Blocker" })).toEqual({ name: "Blocker", level: "urgent" });
    expect(priorityOf({ name: "Lowest" })).toEqual({ name: "Lowest", level: "lowest" });
    expect(priorityOf({ name: "P2 - Soon" })).toEqual({ name: "P2 - Soon", level: null });
    expect(priorityOf(null)).toBeNull();
  });

  test("missing and hostile fields degrade: no assignee, a javascript: avatar, no dates", () => {
    const issue = mapJiraIssue(
      jiraNode("OPS-1", {
        assignee: null,
        reporter: { displayName: "Eve", avatarUrls: { "48x48": "javascript:alert(1)" } },
        project: null,
        created: null,
        updated: "garbage",
        labels: "not a list",
        priority: undefined,
      }),
      cloudCredentials(),
    );
    expect(ProjectIssueSchema.safeParse(issue).success).toBe(true);
    expect(issue.assignees).toEqual([]);
    expect(issue.author).toEqual({ login: "Eve", name: "Eve", avatarUrl: null });
    expect(issue.container).toBe("OPS");
    expect(issue.labels).toEqual([{ name: "Backend", color: null }]);
    expect(issue.priority).toBeNull();
  });

  test("acceptance criteria come from a custom field named so; comments keep the latest, oldest first", () => {
    const fields = {
      customfield_10050: adfParagraph("It signs in"),
      customfield_10051: adfParagraph("Not this one"),
      customfield_10052: null,
    };
    const names = {
      customfield_10050: "Acceptance Criteria",
      customfield_10051: "Story points",
      customfield_10052: "Acceptance criteria (old)",
    };
    expect(sectionsOf(fields, names)).toEqual([
      { title: "Acceptance Criteria", body: "It signs in" },
    ]);

    const many = Array.from({ length: 60 }, (_, index) => ({
      id: String(index),
      author: { displayName: "Sam" },
      body: adfParagraph(`Comment ${index}`),
      created: "2026-09-29T08:00:00.000+0000",
    }));
    const { comments, total } = commentsOf({ comments: many, total: 75 });
    expect(total).toBe(75);
    expect(comments).toHaveLength(50);
    expect(comments[0]).toEqual({
      id: "10",
      author: { login: "Sam", name: "Sam", avatarUrl: null },
      body: "Comment 10",
      createdAt: "2026-09-29T08:00:00.000Z",
    });
    expect(commentsOf(undefined)).toEqual({ comments: [], total: 0 });
  });
});
