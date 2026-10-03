import { describe, expect, test } from "bun:test";
import { jiraListJql, splitOrderBy } from "./jira-jql.ts";

describe("the JQL a Jira list runs", () => {
  test("projects default to their open issues, newest update first", () => {
    expect(jiraListJql({ projects: ["APP", "OPS"], jql: null }, "open")).toBe(
      '(project in ("APP", "OPS")) AND (statusCategory != Done) ORDER BY updated DESC',
    );
    expect(jiraListJql({ projects: ["APP"], jql: null }, "closed")).toBe(
      '(project in ("APP")) AND (statusCategory = Done) ORDER BY updated DESC',
    );
    expect(jiraListJql({ projects: ["APP"], jql: null }, "all")).toBe(
      '(project in ("APP")) ORDER BY updated DESC',
    );
  });

  test("an advanced query is wrapped, keeps its own order, and is narrowed by projects", () => {
    expect(
      jiraListJql(
        { projects: [], jql: "assignee = currentUser() OR labels = ai ORDER BY priority DESC" },
        "open",
      ),
    ).toBe(
      "(assignee = currentUser() OR labels = ai) AND (statusCategory != Done) ORDER BY priority DESC",
    );
    expect(jiraListJql({ projects: ["APP"], jql: "labels = ai" }, "all")).toBe(
      '(project in ("APP")) AND (labels = ai) ORDER BY updated DESC',
    );
  });

  test("an ORDER BY inside quotes is text, not the query's order", () => {
    expect(splitOrderBy('summary ~ "order by date"')).toEqual({
      where: 'summary ~ "order by date"',
      orderBy: null,
    });
    expect(splitOrderBy('summary ~ "x" order by created ASC')).toEqual({
      where: 'summary ~ "x"',
      orderBy: "created ASC",
    });
  });
});
