import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  listCoordinatorMessages,
  sendCoordinatorMessage,
  skipSuggestion,
  startSuggestion,
  unskipSuggestion,
} from "./project-chat";

const originalFetch = globalThis.fetch;
let requests: { method: string; path: string; body: unknown }[] = [];
let answer: Response;

beforeEach(() => {
  requests = [];
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({
      method: init?.method ?? "GET",
      path: String(input),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return answer;
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("project chat api", () => {
  test("lists the coordinator's messages of a project", async () => {
    answer = Response.json({ messages: [{ id: "m1" }] });

    expect(await listCoordinatorMessages("prj 1")).toEqual([{ id: "m1" }] as never);
    expect(requests).toEqual([
      { method: "GET", path: "/api/projects/prj%201/messages", body: undefined },
    ]);
  });

  test("sends text to the coordinator and returns the stored message", async () => {
    answer = Response.json({ message: { id: "m2", text: "hello" } }, { status: 201 });

    expect(await sendCoordinatorMessage("prj_1", "hello")).toEqual({
      id: "m2",
      text: "hello",
    } as never);
    expect(requests).toEqual([
      { method: "POST", path: "/api/projects/prj_1/messages", body: { text: "hello" } },
    ]);
  });

  test("a refused send throws the host's reason", async () => {
    answer = Response.json(
      { error: "Project is paused", code: "PROJECT_NOT_ACTIVE" },
      { status: 409 },
    );

    await expect(sendCoordinatorMessage("prj_1", "hello")).rejects.toThrow("Project is paused");
  });

  test("starts a suggestion by the message and suggestion it is in, and returns the thread", async () => {
    answer = Response.json({ thread: { id: "thr_1" } }, { status: 201 });

    const thread = await startSuggestion("prj 1", "msg/1", "s 2");

    expect(thread).toEqual({ id: "thr_1" } as never);
    expect(requests).toEqual([
      {
        method: "POST",
        path: "/api/projects/prj%201/messages/msg%2F1/suggestions/s%202/start",
        body: undefined,
      },
    ]);
  });

  test("a start the host refuses throws its reason", async () => {
    answer = Response.json(
      { error: "The project is paused", code: "PROJECT_NOT_ACTIVE" },
      { status: 409 },
    );

    await expect(startSuggestion("prj_1", "msg_1", "s1")).rejects.toThrow("The project is paused");
  });

  test("skips a suggestion, and takes the skip back with a DELETE of the same address", async () => {
    answer = Response.json({ answer: { state: "skipped" } });

    await skipSuggestion("prj_1", "msg_1", "s1");
    await unskipSuggestion("prj_1", "msg_1", "s1");

    const path = "/api/projects/prj_1/messages/msg_1/suggestions/s1/skip";
    expect(requests).toEqual([
      { method: "POST", path, body: undefined },
      { method: "DELETE", path, body: undefined },
    ]);
  });
});
