import { describe, expect, test } from "bun:test";
import type { Thread } from "@aop/common";
import { ApiError } from "../../api/request";
import { makeThread } from "../test-utils";
import { explainRepoChange } from "./repo-change-error";

const checkout = { id: "repo_1", name: "checkout", path: "/work/checkout" };
const inUse = new ApiError(
  409,
  "REPO_IN_USE",
  "A thread still works in repository repo_1; stop and delete it first",
);
const thread = (id: string, title: string, status: Thread["status"], repoId = "repo_1") =>
  makeThread({ id, projectId: "p1", title, repoId, status });
const explain = (threads: Thread[]) => explainRepoChange(inUse, checkout, threads);

describe("why a repository could not be removed", () => {
  test("unresolved threads alone: they still work there, and are stopped and deleted", () => {
    expect(explain([thread("t1", "Live work", "idle")])).toBe(
      "“Live work” still works in checkout. Stop and delete it first, then remove the repository.",
    );
    expect(explain([thread("t1", "A", "working"), thread("t2", "B", "idle")])).toBe(
      "2 threads still work in checkout. Stop and delete them first, then remove the repository.",
    );
  });

  test("unresolved and resolved threads: the resolved ones are counted apart, as belonging to it", () => {
    expect(
      explain([
        thread("t1", "Live work", "idle"),
        thread("t2", "Old fix", "resolved"),
        thread("t3", "Older fix", "resolved"),
      ]),
    ).toBe(
      "“Live work” still works in checkout, and 2 resolved threads belong to it. Stop and delete them, then remove the repository.",
    );
    expect(
      explain([
        thread("t1", "A", "working"),
        thread("t2", "B", "queued"),
        thread("t3", "Old fix", "resolved"),
      ]),
    ).toBe(
      "2 threads still work in checkout, and 1 resolved thread belongs to it. Stop and delete them, then remove the repository.",
    );
  });

  test("resolved threads alone: they are never said to work there", () => {
    expect(explain([thread("t1", "Old fix", "resolved"), thread("t2", "Older", "resolved")])).toBe(
      "2 resolved threads belong to checkout. Delete them, then remove the repository.",
    );
    expect(explain([thread("t1", "Old fix", "resolved")])).toBe(
      "1 resolved thread belongs to checkout. Delete it, then remove the repository.",
    );
  });

  test("threads of another repository are not named, and with none the host's words are kept", () => {
    expect(
      explain([thread("t1", "Live work", "idle"), thread("t2", "Elsewhere", "working", "repo_2")]),
    ).toBe(
      "“Live work” still works in checkout. Stop and delete it first, then remove the repository.",
    );
    expect(explain([thread("t2", "Elsewhere", "working", "repo_2")])).toBe(inUse.message);
  });

  test("another refusal keeps the host's message, and a network failure says it plainly", () => {
    expect(
      explainRepoChange(new ApiError(404, "REPO_NOT_FOUND", "No such repo"), checkout, []),
    ).toBe("No such repo");
    expect(explainRepoChange(new Error("offline"), checkout, [])).toBe(
      "Could not change the repositories",
    );
  });
});
