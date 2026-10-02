import { describe, expect, test } from "bun:test";
import {
  activeFilterCount,
  facetsOf,
  filterIssues,
  groupIssues,
  NO_FILTERS,
  sortIssues,
  toggleValue,
  UNASSIGNED,
} from "./issue-view";
import { SAMPLE } from "./test-utils";

const ids = (issues: { identifier: string }[]) => issues.map((issue) => issue.identifier);

describe("filterIssues", () => {
  test("search matches the identifier, title, labels, people, milestone and state", () => {
    expect(ids(filterIssues(SAMPLE, { ...NO_FILTERS, query: "crash" }))).toEqual(["#3"]);
    expect(ids(filterIssues(SAMPLE, { ...NO_FILTERS, query: "ENG-9" }))).toEqual(["ENG-9"]);
    expect(ids(filterIssues(SAMPLE, { ...NO_FILTERS, query: "enhancement" }))).toEqual(["#2"]);
    // "bo" is an assignee of #3 and inside "Onboarding": search is plain text, trimmed and any case.
    expect(ids(filterIssues(SAMPLE, { ...NO_FILTERS, query: "  BO " }))).toEqual(["#3", "ENG-9"]);
    expect(ids(filterIssues(SAMPLE, { ...NO_FILTERS, query: "in progress" }))).toEqual(["ENG-9"]);
  });

  test("values of one filter widen it; filters on different fields narrow each other", () => {
    expect(ids(filterIssues(SAMPLE, { ...NO_FILTERS, labels: ["bug"] }))).toEqual(["#3", "#2"]);
    expect(ids(filterIssues(SAMPLE, { ...NO_FILTERS, labels: ["bug"], authors: ["cy"] }))).toEqual([
      "#2",
    ]);
    expect(ids(filterIssues(SAMPLE, { ...NO_FILTERS, sources: ["linear"] }))).toEqual(["ENG-9"]);
  });

  test("Unassigned matches issues with no assignee", () => {
    expect(ids(filterIssues(SAMPLE, { ...NO_FILTERS, assignees: [UNASSIGNED] }))).toEqual([
      "#2",
      "ENG-9",
      "#1",
    ]);
    expect(
      ids(filterIssues(SAMPLE, { ...NO_FILTERS, assignees: ["bo", UNASSIGNED] })),
    ).toHaveLength(4);
  });
});

describe("sortIssues", () => {
  test("by update, creation either way, and comments", () => {
    expect(ids(sortIssues(SAMPLE, "updated"))).toEqual(["#3", "#2", "ENG-9", "#1"]);
    expect(ids(sortIssues(SAMPLE, "created"))).toEqual(["ENG-9", "#2", "#3", "#1"]);
    expect(ids(sortIssues(SAMPLE, "oldest"))).toEqual(["#1", "#3", "#2", "ENG-9"]);
    expect(ids(sortIssues(SAMPLE, "comments"))).toEqual(["#3", "#2", "ENG-9", "#1"]);
  });
});

describe("groupIssues", () => {
  test("by status follows the workflow, with done work last", () => {
    const groups = groupIssues(SAMPLE, "status");
    expect(groups.map((group) => [group.label, group.issues.length])).toEqual([
      ["In Progress", 1],
      ["Open", 2],
      ["Closed", 1],
    ]);
    expect(groups[0]?.color).toBe("f2c94c");
  });

  test("by label puts an issue in each of its labels, the biggest first and no label last", () => {
    const groups = groupIssues(SAMPLE, "label");
    expect(groups.map((group) => [group.label, ids(group.issues)])).toEqual([
      ["bug", ["#3", "#2"]],
      ["enhancement", ["#2"]],
      ["No label", ["ENG-9", "#1"]],
    ]);
    expect(groups[0]?.color).toBe("d73a4a");
  });

  test("by milestone, assignee and repository", () => {
    expect(groupIssues(SAMPLE, "milestone").map((group) => group.label)).toEqual([
      "Cycle 3",
      "v1",
      "No milestone",
    ]);
    expect(groupIssues(SAMPLE, "assignee").map((group) => group.label)).toEqual([
      "bo",
      "Unassigned",
    ]);
    expect(
      groupIssues(SAMPLE, "repository").map((group) => [group.label, group.issues.length]),
    ).toEqual([
      ["acme/app", 3],
      ["Engineering", 1],
    ]);
  });
});

describe("facets and filter helpers", () => {
  test("the values each filter offers, with counts, most common first", () => {
    const facets = facetsOf(SAMPLE);
    expect(facets.labels.map((facet) => [facet.label, facet.count, facet.color])).toEqual([
      ["bug", 2, "d73a4a"],
      ["enhancement", 1, "a2eeef"],
    ]);
    expect(facets.assignees.map((facet) => [facet.value, facet.count])).toEqual([
      [UNASSIGNED, 3],
      ["bo", 1],
    ]);
    expect(facets.authors.map((facet) => [facet.value, facet.count])).toEqual([
      ["ada", 3],
      ["cy", 1],
    ]);
  });

  test("toggling a value and counting the active filters", () => {
    expect(toggleValue(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleValue(["a", "b"], "a")).toEqual(["b"]);
    expect(
      activeFilterCount({ ...NO_FILTERS, query: "x", labels: ["a"], sources: ["github"] }),
    ).toBe(2);
  });
});
