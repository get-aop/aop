import { afterEach, describe, expect, test } from "bun:test";
import type { Message, Project } from "@aop/common";
import type { ChatSession } from "../db/schema.ts";
import { createProjectStack, type ProjectStack, useTempAopHome } from "../project/test-utils.ts";

// ask_person as the coordinator calls it: what it refuses, and, with the fake CLI standing in for
// Claude, the question block its reply carries for the dashboard to draw as buttons.

const home = useTempAopHome();
let stack: ProjectStack | undefined;

afterEach(async () => {
  await stack?.cleanup();
  stack = undefined;
});

const createProject = async (s: ProjectStack): Promise<Project> => {
  const created = await s.api<{ project: Project }>("POST", "/api/projects", {
    name: "Checkout",
    repoIds: s.repos.map((repo) => repo.id),
  });
  expect(created.status).toBe(201);
  return created.body.project;
};

const coordinatorOf = async (s: ProjectStack, projectId: string): Promise<ChatSession> =>
  (await s.ctx.chatSessionRepository.getCoordinator(projectId)) as ChatSession;

const messagesOf = async (s: ProjectStack, projectId: string): Promise<Message[]> =>
  (await s.api<{ messages: Message[] }>("GET", `/api/projects/${projectId}/messages`)).body
    .messages;

const askCall = (args: Record<string, unknown>): string =>
  `[fake: say="One question first." calls='${JSON.stringify([{ name: "ask_person", arguments: args }])}']`;

const errorOf = (result: { isError?: boolean; content: { text: string }[] }): string => {
  expect(result.isError).toBe(true);
  return result.content[0]?.text ?? "";
};

describe("ask_person", () => {
  test("refuses fewer than two or more than five options, two recommended, or the same label twice", async () => {
    const s = await createProjectStack(home.path());
    stack = s;
    const coordinator = await coordinatorOf(s, (await createProject(s)).id);
    const ask = (args: Record<string, unknown>) =>
      s.callTool(coordinator.id, "ask_person", { question: "Merge it?", ...args });

    expect(errorOf(await ask({ options: ["Yes"] }))).toContain("options");
    expect(errorOf(await ask({ options: ["1", "2", "3", "4", "5", "6"] }))).toContain("options");
    expect(
      errorOf(
        await ask({
          options: [
            { label: "Yes", recommended: true },
            { label: "No", recommended: true },
          ],
        }),
      ),
    ).toContain("At most one option can be recommended");
    expect(errorOf(await ask({ options: ["Yes", "Yes"] }))).toContain("a label of its own");
    expect(errorOf(await ask({ options: ["Yes", "No"], recommended: "Maybe" }))).toContain(
      "`recommended` must match one of the options",
    );
  });

  test("needs a reply being written to attach the question to", async () => {
    const s = await createProjectStack(home.path());
    stack = s;
    const coordinator = await coordinatorOf(s, (await createProject(s)).id);

    const result = await s.callTool(coordinator.id, "ask_person", {
      question: "Merge it?",
      options: ["Yes", "No"],
    });

    expect(errorOf(result)).toContain("No reply is being written");
  });

  test("is the coordinator's alone: a thread is not offered it", async () => {
    const s = await createProjectStack(home.path(), { repos: 1 });
    stack = s;
    const project = await createProject(s);
    const spawned = await s.services.threads.spawn(project.id, { title: "Audit", prompt: "Audit" });
    if (!spawned.success) throw new Error("thread not spawned");
    await s.settle();

    const { body } = await s.mcp(spawned.thread.id, "tools/call", {
      name: "ask_person",
      arguments: { question: "Merge it?", options: ["Yes", "No"] },
    });

    expect(body.error).toMatchObject({ message: "Unknown tool: ask_person" });
  });

  test("puts the question under the coordinator's reply, where it stays after the person answers", async () => {
    const s = await createProjectStack(home.path(), { mcp: true });
    stack = s;
    const project = await createProject(s);

    const sent = await s.api("POST", `/api/projects/${project.id}/messages`, {
      text: `The checkout thread is done. ${askCall({
        question: "Merge its pull request by itself, or wait for you?",
        options: ["Merge by itself", { label: "Wait for me" }, "Close it"],
        recommended: "Wait for me",
        other: true,
      })}`,
    });
    expect(sent.status).toBe(201);
    await s.settle();

    const reply = (await messagesOf(s, project.id)).find((message) => message.role === "assistant");
    const blocks = reply?.role === "assistant" ? reply.blocks : [];
    expect(blocks.map((block) => block.type)).toEqual(["tool", "text", "question"]);
    expect(blocks[2]).toEqual({
      type: "question",
      question: "Merge its pull request by itself, or wait for you?",
      options: [
        { label: "Merge by itself" },
        { label: "Wait for me", recommended: true },
        { label: "Close it" },
      ],
      other: true,
    });

    // The person's click is an ordinary message of theirs; the question stays as it was asked.
    const answered = await s.api("POST", `/api/projects/${project.id}/messages`, {
      text: "Wait for me",
    });
    expect(answered.status).toBe(201);
    await s.settle();
    const after = await messagesOf(s, project.id);
    const again = after.find(({ id }) => id === reply?.id);
    expect(again?.role === "assistant" && again.blocks.at(-1)).toEqual(blocks[2] as never);
    expect(
      after.filter((message) => message.role === "user").map((message) => message.sender),
    ).toEqual(["person", "person"]);
  }, 60_000);
});
