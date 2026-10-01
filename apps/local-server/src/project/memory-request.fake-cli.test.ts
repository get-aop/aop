import { afterEach, describe, expect, test } from "bun:test";
import type { MemoryFile, Message, Project } from "@aop/common";
import { createProjectStack, type ProjectStack, useTempAopHome } from "./test-utils.ts";

// Memory settings' "Tell Claude what to change or remove", end to end with the fake CLI standing
// in for Claude: the request reaches the coordinator framed, the coordinator changes memory over
// real MCP calls, and its reply answers the request the person sees in the chat.

const home = useTempAopHome();
let stack: ProjectStack | undefined;

afterEach(async () => {
  await stack?.cleanup();
  stack = undefined;
});

const calls = (...items: Array<{ name: string; arguments: Record<string, unknown> }>): string =>
  `[fake: calls='${JSON.stringify(items)}' say="Updated MEMORY.md and deleted fridays.md."]`;

const createProject = async (s: ProjectStack): Promise<Project> => {
  const created = await s.api<{ project: Project }>("POST", "/api/projects", { name: "Checkout" });
  expect(created.status).toBe(201);
  return created.body.project;
};

const memoryOf = async (s: ProjectStack, projectId: string): Promise<MemoryFile[]> =>
  (await s.api<{ files: MemoryFile[] }>("GET", `/api/projects/${projectId}/memory`)).body.files;

describe("asking the coordinator to change memory", () => {
  test("the coordinator writes and deletes memory files, and its reply answers the request", async () => {
    stack = await createProjectStack(home.path(), { mcp: true });
    const s = stack;
    const project = await createProject(s);
    await s.services.memory.write(project.id, {
      name: "fridays.md",
      description: "The Friday freeze",
      body: "No deploys on Fridays.",
    });
    const request = `Forget the Friday freeze; deploys go out on Tuesdays. ${calls(
      {
        name: "memory_write",
        arguments: { name: "MEMORY.md", body: "- Deploys go out on Tuesdays" },
      },
      { name: "memory_delete", arguments: { name: "fridays.md" } },
    )}`;

    const sent = await s.api<{ message: Message }>(
      "POST",
      `/api/projects/${project.id}/memory/requests`,
      { text: `  ${request}  ` },
    );
    expect(sent.status).toBe(201);
    expect(sent.body.message).toMatchObject({ role: "user", threadId: null, text: request });
    await s.settle();

    const files = await memoryOf(s, project.id);
    expect(files.map((file) => [file.name, file.body])).toEqual([
      ["MEMORY.md", "- Deploys go out on Tuesdays"],
    ]);
    // The coordinator is told where the request came from and what to do with it.
    const [run] = s.runs;
    expect(run?.prompt).toContain("from the project's Memory settings");
    expect(run?.prompt).toContain(`<request>\n${request}\n</request>`);
    // The chat shows the person's words, and the reply answers that message.
    const { messages } = (
      await s.api<{ messages: Message[] }>("GET", `/api/projects/${project.id}/messages`)
    ).body;
    const asked = messages.find((message) => message.id === sent.body.message.id);
    expect(asked).toMatchObject({ role: "user", text: request });
    const reply = messages.find(
      (message) => message.role === "assistant" && message.inReplyTo === sent.body.message.id,
    );
    const blocks = reply?.role === "assistant" ? reply.blocks : [];
    expect(blocks.map((block) => (block.type === "tool" ? block.name : block.type))).toEqual([
      "mcp aop memory write",
      "mcp aop memory delete",
      "text",
    ]);
    expect(blocks.at(-1)).toEqual({
      type: "text",
      text: "Updated MEMORY.md and deleted fridays.md.",
    });
  }, 60_000);

  test("the index cannot be deleted: the tool call comes back as an error and the index stays", async () => {
    stack = await createProjectStack(home.path(), { mcp: true });
    const s = stack;
    const project = await createProject(s);
    await s.services.memory.write(project.id, {
      name: "MEMORY.md",
      description: "",
      body: "- keep me",
    });

    await s.api("POST", `/api/projects/${project.id}/memory/requests`, {
      text: `Delete everything. ${calls({ name: "memory_delete", arguments: { name: "MEMORY.md" } })}`,
    });
    await s.settle();

    expect((await memoryOf(s, project.id)).map((file) => file.body)).toEqual(["- keep me"]);
  }, 60_000);

  test("an empty request, and one to a paused project, are refused before the coordinator sees them", async () => {
    stack = await createProjectStack(home.path());
    const s = stack;
    const project = await createProject(s);

    const empty = await s.api<{ error: string }>(
      "POST",
      `/api/projects/${project.id}/memory/requests`,
      { text: "   " },
    );
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe("Say what to change or remove");

    await s.api("POST", `/api/projects/${project.id}/pause`);
    const paused = await s.api<{ error: string }>(
      "POST",
      `/api/projects/${project.id}/memory/requests`,
      { text: "Forget the freeze" },
    );
    expect(paused.status).toBe(409);
    expect(paused.body.error).toBe("The project is paused");
    expect(s.runs).toHaveLength(0);
  });
});
