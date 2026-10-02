import { describe, expect, test } from "bun:test";
import { makeEntry, makeProject, makeThread } from "../../projects/test-utils";
import { othersWaiting, switcherSections } from "./switcher-model";

const entries = () => [
  makeEntry(makeProject({ id: "a", name: "Alpha", updatedAt: "2026-09-29T12:00:00.000Z" })),
  makeEntry(
    makeProject({
      id: "b",
      name: "Bravo",
      goal: "Ship the storefront redesign",
      updatedAt: "2026-09-29T11:00:00.000Z",
    }),
  ),
  makeEntry(makeProject({ id: "c", name: "Charlie", status: "archived" })),
];

const ids = (sections: ReturnType<typeof switcherSections>) =>
  sections.map((section) => [section.id, section.entries.map((entry) => entry.project.id)]);

describe("switcherSections", () => {
  test("lists projects newest first, archived ones last in their own section", () => {
    expect(ids(switcherSections(entries(), [], ""))).toEqual([
      ["projects", ["a", "b"]],
      ["archived", ["c"]],
    ]);
  });

  test("pinned projects lead in their own section", () => {
    expect(ids(switcherSections(entries(), ["b"], ""))).toEqual([
      ["pinned", ["b"]],
      ["projects", ["a"]],
      ["archived", ["c"]],
    ]);
  });

  test("filters by name or goal, ignoring case and spaces around the query, and drops empty sections", () => {
    expect(ids(switcherSections(entries(), [], "  ALP "))).toEqual([["projects", ["a"]]]);
    expect(ids(switcherSections(entries(), [], "redesign"))).toEqual([["projects", ["b"]]]);
    expect(ids(switcherSections(entries(), [], "char"))).toEqual([["archived", ["c"]]]);
    expect(switcherSections(entries(), [], "nothing like it")).toEqual([]);
  });
});

describe("othersWaiting", () => {
  const waitingIn = (projectId: string) =>
    makeEntry(makeProject({ id: projectId, name: projectId }), [
      makeThread({ projectId, status: "waiting-on-you" }),
    ]);
  const quiet = (projectId: string) =>
    makeEntry(makeProject({ id: projectId, name: projectId }), [
      makeThread({ projectId, status: "working" }),
    ]);

  test("is true when a project other than the open one waits on the person", () => {
    expect(othersWaiting([quiet("a"), waitingIn("b")], "a")).toBe(true);
  });

  test("ignores the open project's own waiting threads, which its screen already shows", () => {
    expect(othersWaiting([waitingIn("a"), quiet("b")], "a")).toBe(false);
  });

  test("with no project open, any waiting project counts", () => {
    expect(othersWaiting([waitingIn("a")], null)).toBe(true);
    expect(othersWaiting([quiet("a")], null)).toBe(false);
  });
});
