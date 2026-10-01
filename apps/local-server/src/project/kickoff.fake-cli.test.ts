import { afterEach, describe, expect, test } from "bun:test";
import type { Message, MessageBlock, Project, Thread } from "@aop/common";
import { READ_ONLY_COMMANDS } from "../chat-session/run-profile.ts";
import { createKickoffRepository } from "./kickoff-repository.ts";
import { createProjectStack, eventually, type ProjectStack, useTempAopHome } from "./test-utils.ts";

// A new project's first open against the fake CLI, with no message from the person: the host's
// welcome, the read-only survey thread, and the coordinator's summary and proposals once the
// survey reports. The fake scripts a turn from a marker in its prompt; the survey's report asks
// the coordinator to weigh its proposals against the goal, so a marker in the goal scripts the
// coordinator's proposals. Everything else (engine, MCP over HTTP, database) is real.

const home = useTempAopHome();
let stack: ProjectStack | undefined;

afterEach(async () => {
  await stack?.cleanup();
  stack = undefined;
});

const PROPOSALS = [
  {
    title: "Fix the failing main build",
    prompt: "Find why main went red and fix it.",
    reason: "Every open change is tested on a broken base until this is fixed.",
  },
  {
    title: "Get the Sorcerer skills foundation merged",
    prompt: "Drive the foundation pull request to green.",
    reason: "It blocks the remaining Sorcerer units.",
  },
];

// `links` ends the reply with the link to the survey that the report's ask holds.
const PROPOSING_GOAL = `Ship the alpha [fake: say="Umbral is a playable alpha. Details are in" links calls='${JSON.stringify(
  [{ name: "propose_threads", arguments: { threads: PROPOSALS } }],
)}']`;

const create = async (
  s: ProjectStack,
  body: { goal?: string; repos?: boolean; lookAround?: boolean },
): Promise<Project> => {
  const created = await s.api<{ project: Project }>("POST", "/api/projects", {
    name: "Umbral",
    goal: body.goal ?? "",
    repoIds: body.repos === false ? [] : s.repos.map((repo) => repo.id),
    ...(body.lookAround !== undefined && { lookAround: body.lookAround }),
  });
  expect(created.status).toBe(201);
  return created.body.project;
};

const threadsOf = async (s: ProjectStack, projectId: string): Promise<Thread[]> =>
  (await s.api<{ threads: Thread[] }>("GET", `/api/projects/${projectId}/threads`)).body.threads;

const messagesOf = async (s: ProjectStack, projectId: string): Promise<Message[]> =>
  (await s.api<{ messages: Message[] }>("GET", `/api/projects/${projectId}/messages`)).body
    .messages;

const blocksOf = (message: Message | undefined): MessageBlock[] =>
  message?.role === "assistant" ? message.blocks : [];

const isWelcome = (message: Message): boolean =>
  blocksOf(message).some(
    (block) => block.type === "text" && block.text.startsWith("Welcome to your new project."),
  );

describe("a new project's first open", () => {
  test("with a repository: a welcome with the survey's card, a read-only survey, then a summary linking it and suggested threads, and no message from the person", async () => {
    stack = await createProjectStack(home.path(), { mcp: true });
    const s = stack;
    const project = await create(s, { goal: PROPOSING_GOAL, lookAround: true });

    const survey = await eventually(
      async () => (await threadsOf(s, project.id))[0],
      "the survey thread",
    );
    expect(survey.title).toBe("What Umbral does and what's in flight");

    const welcome = await eventually(
      async () => (await messagesOf(s, project.id)).find(isWelcome),
      "the welcome",
    );
    const welcomeBlocks = blocksOf(welcome);
    expect(welcomeBlocks.map((block) => block.type)).toEqual(["text", "thread-card"]);
    expect(welcomeBlocks[0]?.type === "text" && welcomeBlocks[0].text).toContain(
      "I'll look at what Umbral does and what's in flight in it.",
    );
    expect(welcomeBlocks[1]).toEqual({
      type: "thread-card",
      threadId: survey.id,
      variant: "live",
    });

    // The survey runs read-only whatever the project gives its threads (full access here).
    expect(project.threadAccess).toBe("full-access");
    const surveyRun = await eventually(
      () => s.runs.find((run) => run.env?.AOP_CHAT_SESSION_ID === survey.id),
      "the survey's run",
    );
    expect(surveyRun.accessMode).toBe("approval-required");
    expect(surveyRun.allowedTools).toEqual(expect.arrayContaining(READ_ONLY_COMMANDS));
    expect(surveyRun.prompt).toContain("This is a read-only look");

    const summary = await eventually(
      async () =>
        (await messagesOf(s, project.id)).find((message) =>
          blocksOf(message).some((block) => block.type === "suggested-threads"),
        ),
      "the coordinator's summary with its proposals",
      30_000,
    );
    const summaryBlocks = blocksOf(summary);
    // The chip stands for the survey: the summary carries no card of it.
    expect(summaryBlocks.map((block) => block.type)).toEqual([
      "text",
      "thread-chip",
      "suggested-threads",
    ]);
    expect(summaryBlocks[1]).toEqual({ type: "thread-chip", threadId: survey.id });
    const proposals = summaryBlocks.find((block) => block.type === "suggested-threads");
    expect(
      proposals?.type === "suggested-threads" &&
        proposals.suggestions.map(({ title, reason }) => ({ title, reason })),
    ).toEqual(PROPOSALS.map(({ title, reason }) => ({ title, reason })));

    const messages = await messagesOf(s, project.id);
    expect(messages.filter((message) => message.role === "user")).toEqual([]);
    const reports = messages.filter((message) => message.role === "thread-report");
    expect(reports).toHaveLength(1);
    expect(reports[0]?.role === "thread-report" && reports[0].text).toContain(
      "This was your first look at the project",
    );
    // Proposals start nothing: the survey is still the only thread.
    expect((await threadsOf(s, project.id)).map((thread) => thread.id)).toEqual([survey.id]);
  }, 60_000);

  test("with the look-around off, nothing is posted and nothing runs", async () => {
    stack = await createProjectStack(home.path(), { mcp: true });
    const s = stack;
    const off = await create(s, { goal: PROPOSING_GOAL, lookAround: false });
    const omitted = await create(s, { goal: PROPOSING_GOAL });
    await Bun.sleep(300);
    await s.settle();

    for (const project of [off, omitted]) {
      expect(await messagesOf(s, project.id)).toEqual([]);
      expect(await threadsOf(s, project.id)).toEqual([]);
    }
    expect(s.runs).toEqual([]);
    expect(await s.db.selectFrom("project_kickoffs").selectAll().execute()).toEqual([]);
  });

  test("with no repository, the welcome only: no survey, and nothing runs", async () => {
    stack = await createProjectStack(home.path(), { mcp: true });
    const s = stack;
    const project = await create(s, { goal: PROPOSING_GOAL, repos: false, lookAround: true });
    await Bun.sleep(300);
    await s.settle();

    const messages = await messagesOf(s, project.id);
    expect(messages).toHaveLength(1);
    const blocks = blocksOf(messages[0]);
    expect(blocks.map((block) => block.type)).toEqual(["text"]);
    expect(blocks[0]?.type === "text" && blocks[0].text).toContain(
      "This project has no repository yet",
    );
    expect(await threadsOf(s, project.id)).toEqual([]);
    expect(s.runs).toEqual([]);
  });

  test("a kickoff a restart left pending starts its survey once, however often it is picked up", async () => {
    stack = await createProjectStack(home.path(), { mcp: true });
    const s = stack;
    // A project whose host stopped between creating it and starting its survey.
    const project = await create(s, { lookAround: false });
    await createKickoffRepository(s.db).insertPending(project.id);

    // The restarted host picks it up, and a second start races it.
    await Promise.all([s.services.kickoff.resumePending(), s.services.kickoff.start(project.id)]);
    await s.services.kickoff.resumePending();

    const threads = await threadsOf(s, project.id);
    expect(threads.map((thread) => thread.title)).toEqual([
      "What Umbral does and what's in flight",
    ]);
    expect((await messagesOf(s, project.id)).filter(isWelcome)).toHaveLength(1);
    expect(await s.db.selectFrom("project_kickoffs").selectAll().execute()).toEqual([
      { project_id: project.id, state: "surveying", survey_thread_id: threads[0]?.id ?? "" },
    ]);
    await s.settle();
  }, 30_000);
});
