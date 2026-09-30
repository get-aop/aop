import { describe, expect, test } from "bun:test";
import type { SuggestionAnswer } from "@aop/common";
import { type ProjectStack, projectSettings } from "../project/test-utils.ts";
import { git } from "../thread/git-test-utils.ts";
import { useThreadWorld } from "../thread/test-utils.ts";
import {
  answersIn,
  countThreads,
  listedAnswers,
  proposeThreads,
  updatedMessages,
} from "./test-utils.ts";

const { setup } = useThreadWorld();

const proposals = (repoId: string | null = null) => [
  { title: "Add retry metrics", prompt: "Add a metric to every retry.", repoId },
  { title: "Load test checkout", prompt: "Load test it.", repoId: null },
];

const answerRows = (s: ProjectStack) => s.db.selectFrom("suggestion_answers").selectAll().execute();

describe("starting a suggested thread", () => {
  test("starts the thread the suggestion proposes and records it as the answer, in the log after the thread", async () => {
    const { s, project } = await setup();
    const repoId = s.repos[0]?.id ?? null;
    const proposal = await proposeThreads(s, project.id, proposals(repoId));

    const started = await s.services.suggestions.start(
      project.id,
      proposal.messageId,
      proposal.suggestions[0]?.id ?? "",
    );
    await s.settle();

    expect(started).toMatchObject({
      success: true,
      created: true,
      thread: { title: "Add retry metrics", projectId: project.id, repoId },
    });
    const threadId = started.success ? started.thread.id : "";
    const answers: (SuggestionAnswer | null)[] = [{ state: "started", threadId }, null];
    expect(await listedAnswers(s, project.id, proposal.messageId)).toEqual(answers);
    expect(answersIn((await updatedMessages(s, project.id))[0])).toEqual(answers);
    const brief = (await s.ctx.chatSessionRepository.listMessages(threadId))[0];
    expect(brief?.content).toBe("Add a metric to every retry.");

    const types = (await s.db.selectFrom("event_log").select("type").orderBy("id").execute()).map(
      ({ type }) => type,
    );
    expect(types.indexOf("thread.upserted")).toBeGreaterThanOrEqual(0);
    expect(types.indexOf("message.updated")).toBeGreaterThan(types.indexOf("thread.upserted"));
  });

  test("starting it again answers with the same thread and makes nothing", async () => {
    const { s, project } = await setup();
    const proposal = await proposeThreads(s, project.id, proposals());
    const id = proposal.suggestions[0]?.id ?? "";

    const first = await s.services.suggestions.start(project.id, proposal.messageId, id);
    await s.settle();
    const again = await s.services.suggestions.start(project.id, proposal.messageId, id);

    expect(first).toMatchObject({ success: true, created: true });
    expect(again).toMatchObject({ success: true, created: false });
    expect(again.success && again.thread.id).toBe(first.success ? first.thread.id : "");
    expect(await countThreads(s, project.id)).toBe(1);
    expect(await updatedMessages(s, project.id)).toHaveLength(1);
  });

  test("clicks that arrive together start one thread, and every one of them gets it back", async () => {
    const { s, project } = await setup();
    const proposal = await proposeThreads(s, project.id, proposals());
    const id = proposal.suggestions[0]?.id ?? "";

    const results = await Promise.all(
      [1, 2, 3, 4].map(() => s.services.suggestions.start(project.id, proposal.messageId, id)),
    );
    await s.settle();

    const threadIds = results.map((result) => (result.success ? result.thread.id : null));
    expect(threadIds[0]).not.toBeNull();
    expect(new Set(threadIds).size).toBe(1);
    expect(results.filter((result) => result.success && result.created)).toHaveLength(1);
    expect(await countThreads(s, project.id)).toBe(1);
    expect(await answerRows(s)).toEqual([
      {
        message_id: proposal.messageId,
        suggestion_id: id,
        state: "started",
        thread_id: threadIds[0] ?? null,
      },
    ]);
  });

  test("two suggestions of one message start threads of their own, side by side", async () => {
    const { s, project } = await setup();
    const proposal = await proposeThreads(s, project.id, proposals());

    const [first, second] = await Promise.all(
      proposal.suggestions.map(({ id }) =>
        s.services.suggestions.start(project.id, proposal.messageId, id),
      ),
    );
    await s.settle();

    expect(first?.success && second?.success && first.thread.id !== second.thread.id).toBe(true);
    expect(await countThreads(s, project.id)).toBe(2);
    expect(await answerRows(s)).toHaveLength(2);
  });

  test("a project that is not active starts nothing and records nothing", async () => {
    const { s, project } = await setup();
    const proposal = await proposeThreads(s, project.id, proposals());
    const id = proposal.suggestions[0]?.id ?? "";
    await s.services.projects.transition(project.id, "pause");

    const refused = await s.services.suggestions.start(project.id, proposal.messageId, id);

    expect(refused).toEqual({
      success: false,
      error: { code: "PROJECT_NOT_ACTIVE", status: "paused" },
    });
    expect(await answerRows(s)).toEqual([]);
    await s.services.projects.transition(project.id, "resume");
    const later = await s.services.suggestions.start(project.id, proposal.messageId, id);
    await s.settle();
    expect(later).toMatchObject({ success: true, created: true });
  });

  test("a thread that cannot be set up leaves its proposal open, and clients are told twice", async () => {
    const { s, project } = await setup();
    const proposal = await proposeThreads(s, project.id, proposals(s.repos[0]?.id ?? null));
    const id = proposal.suggestions[0]?.id ?? "";
    const repoPath = s.repos[0]?.path ?? "";
    git(repoPath, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/develop");

    const failed = await s.services.suggestions.start(project.id, proposal.messageId, id);

    expect(failed).toMatchObject({ success: false, error: { code: "WORKTREE_FAILED" } });
    expect(await answerRows(s)).toEqual([]);
    expect(await countThreads(s, project.id)).toBe(0);
    const told = (await updatedMessages(s, project.id)).map((message) => answersIn(message));
    expect(told).toEqual([
      [expect.objectContaining({ state: "started" }), null],
      [null, null],
    ]);

    git(repoPath, "symbolic-ref", "--delete", "refs/remotes/origin/HEAD");
    const retried = await s.services.suggestions.start(project.id, proposal.messageId, id);
    await s.settle();
    expect(retried).toMatchObject({ success: true, created: true });
  });

  test("deleting the thread a suggestion started opens the proposal again", async () => {
    const { s, project } = await setup();
    const proposal = await proposeThreads(s, project.id, proposals());
    const id = proposal.suggestions[0]?.id ?? "";
    const started = await s.services.suggestions.start(project.id, proposal.messageId, id);
    await s.settle();
    if (!started.success) throw new Error("not started");

    const removed = await s.services.threads.remove(started.thread.id);

    expect(removed.success).toBe(true);
    expect(await listedAnswers(s, project.id, proposal.messageId)).toEqual([null, null]);
    expect(answersIn((await updatedMessages(s, project.id)).at(-1))).toEqual([null, null]);
    const again = await s.services.suggestions.start(project.id, proposal.messageId, id);
    await s.settle();
    expect(again).toMatchObject({ success: true, created: true });
    expect(again.success && again.thread.id).not.toBe(started.thread.id);
  });
});

describe("skipping a suggested thread", () => {
  test("records the skip, tells clients once, and is the same when repeated", async () => {
    const { s, project } = await setup();
    const proposal = await proposeThreads(s, project.id, proposals());
    const id = proposal.suggestions[0]?.id ?? "";

    const first = await s.services.suggestions.skip(project.id, proposal.messageId, id);
    const again = await s.services.suggestions.skip(project.id, proposal.messageId, id);

    expect(first).toEqual({ success: true, answer: { state: "skipped" } });
    expect(again).toEqual(first);
    expect(await listedAnswers(s, project.id, proposal.messageId)).toEqual([
      { state: "skipped" },
      null,
    ]);
    expect(await updatedMessages(s, project.id)).toHaveLength(1);
    expect(await countThreads(s, project.id)).toBe(0);
  });

  test("taking the skip back opens the proposal, and one that was never skipped stays as it is", async () => {
    const { s, project } = await setup();
    const proposal = await proposeThreads(s, project.id, proposals());
    const [first, second] = proposal.suggestions;
    await s.services.suggestions.skip(project.id, proposal.messageId, first?.id ?? "");

    const undone = await s.services.suggestions.unskip(
      project.id,
      proposal.messageId,
      first?.id ?? "",
    );
    const untouched = await s.services.suggestions.unskip(
      project.id,
      proposal.messageId,
      second?.id ?? "",
    );

    expect(undone).toEqual({ success: true, answer: null });
    expect(untouched).toEqual({ success: true, answer: null });
    expect(await listedAnswers(s, project.id, proposal.messageId)).toEqual([null, null]);
    expect(await updatedMessages(s, project.id)).toHaveLength(2);
  });

  test("a skipped proposal can still be started, and a started one is neither skipped nor unskipped", async () => {
    const { s, project } = await setup();
    const proposal = await proposeThreads(s, project.id, proposals());
    const id = proposal.suggestions[0]?.id ?? "";
    await s.services.suggestions.skip(project.id, proposal.messageId, id);

    const started = await s.services.suggestions.start(project.id, proposal.messageId, id);
    await s.settle();
    const skipped = await s.services.suggestions.skip(project.id, proposal.messageId, id);
    const unskipped = await s.services.suggestions.unskip(project.id, proposal.messageId, id);

    const standing: SuggestionAnswer = {
      state: "started",
      threadId: started.success ? started.thread.id : "",
    };
    expect(started).toMatchObject({ success: true, created: true });
    expect(skipped).toEqual({ success: true, answer: standing });
    expect(unskipped).toEqual({ success: true, answer: standing });
    expect(await listedAnswers(s, project.id, proposal.messageId)).toEqual([standing, null]);
    expect(await updatedMessages(s, project.id)).toHaveLength(2);
  });
});

describe("a suggestion that is not there", () => {
  test("is refused for an unknown project, message or suggestion, and for another project's message", async () => {
    const { s, project } = await setup();
    const other = await s.services.projects.create(projectSettings({ name: "Other" }));
    const proposal = await proposeThreads(s, project.id, proposals());
    const id = proposal.suggestions[0]?.id ?? "";
    const notFound = { success: false, error: { code: "SUGGESTION_NOT_FOUND" } } as const;

    expect(await s.services.suggestions.start("proj_nope", proposal.messageId, id)).toEqual({
      success: false,
      error: { code: "PROJECT_NOT_FOUND" },
    });
    expect(await s.services.suggestions.start(project.id, "msg_nope", id)).toEqual(notFound);
    expect(await s.services.suggestions.skip(project.id, proposal.messageId, "sug_nope")).toEqual(
      notFound,
    );
    expect(
      await s.services.suggestions.start(
        other.success ? other.project.id : "",
        proposal.messageId,
        id,
      ),
    ).toEqual(notFound);
    expect(await answerRows(s)).toEqual([]);
    expect(await countThreads(s, project.id)).toBe(0);
  });
});
