import { describe, expect, test } from "bun:test";
import {
  draftFromRoutine,
  draftProblems,
  draftToInput,
  duplicateDraft,
  emptyDraft,
} from "./routine-draft";
import { makeRoutine } from "./test-utils";

describe("the routine draft", () => {
  test("sends only the fields of the chosen schedule kind", () => {
    const draft = { ...emptyDraft("repo_1"), name: "Digest", prompt: "Summarize" };
    expect(draftToInput({ ...draft, kind: "weekly", days: [5, 1] }).schedule).toEqual({
      kind: "weekly",
      days: [1, 5],
      time: "09:00",
    });
    expect(draftToInput({ ...draft, kind: "hourly", every: 3, minute: 15 }).schedule).toEqual({
      kind: "hourly",
      every: 3,
      minute: 15,
    });
    expect(draftToInput({ ...draft, kind: "cron", expression: "0 9 1 * *" }).schedule).toEqual({
      kind: "cron",
      expression: "0 9 1 * *",
    });
  });

  test("a message to the coordinator carries no repository, model or effort", () => {
    const input = draftToInput({
      ...emptyDraft("repo_1"),
      name: "Report",
      prompt: "Write it",
      target: "coordinator",
      model: "opus",
      effort: "high",
    });
    expect(input).toMatchObject({ repoId: null, model: null, effort: null });
  });

  test("an edit starts from the routine, and a copy is paused under its own name", () => {
    const routine = makeRoutine({ schedule: { kind: "weekly", days: [5], time: "17:00" } });
    expect(draftFromRoutine(routine)).toMatchObject({
      name: "Morning digest",
      kind: "weekly",
      days: [5],
      time: "17:00",
      enabled: true,
    });
    expect(duplicateDraft(routine)).toMatchObject({
      name: "Morning digest (copy)",
      enabled: false,
    });
  });

  test("names what is missing or wrong, per field", () => {
    expect(draftProblems({ ...emptyDraft(null), kind: "cron", expression: "0 25 * * *" })).toEqual({
      name: "Name is required.",
      prompt: "What it does is required.",
      schedule: "Hour: 25 is outside 0-23",
    });
    expect(draftProblems({ ...emptyDraft(null), name: "a", prompt: "b" })).toEqual({});
  });
});
