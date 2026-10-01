import { mock } from "bun:test";
import type { Message, Project, Thread } from "@aop/common";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { ProjectsProvider } from "../ProjectsProvider";
import { makeEntry, makeProject, makeState, stubLiveProjects } from "../test-utils";
import { CoordinatorChatPane } from "./CoordinatorChatPane";
import type { ChatApi } from "./chat-api";
import { createProjectChat } from "./project-chat";
import { createFakeEvents, memorySeenStore, pageFrom, userMessage } from "./test-utils";

// Import this after `setupDashboardDom()` (with `await import`), as the testing library needs the DOM.

export interface FetchLog {
  requests: { method: string; url: string; body: unknown }[];
  /** What the host answers; replace it to change the answer. */
  respond: (method: string, url: string) => Response;
  restore: () => void;
}

/** Replaces `fetch` with one that records each request and answers with `respond`. */
export const mockFetch = (): FetchLog => {
  const original = globalThis.fetch;
  const log: FetchLog = {
    requests: [],
    respond: () => new Response(null, { status: 204 }),
    restore: () => {
      globalThis.fetch = original;
    },
  };
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    log.requests.push({
      method,
      url: String(input),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return log.respond(method, String(input));
  }) as unknown as typeof fetch;
  return log;
};

type Chat = ReturnType<typeof createProjectChat>;

const Harness = ({
  chat,
  project,
  threads,
}: {
  chat: Chat;
  project: Project;
  threads: Thread[];
}) => {
  const model = useSyncExternalStore(chat.subscribe, chat.getState);
  return (
    <CoordinatorChatPane
      project={project}
      threads={threads}
      threadsLoaded
      threadsError={null}
      chat={chat}
      model={model}
    />
  );
};

export interface PaneOptions {
  project?: Project;
  threads?: Thread[];
  fetches?: Promise<Message[]>[];
  listMessages?: ChatApi["listMessages"];
  seen?: Record<string, string>;
  sendMessage?: ChatApi["sendMessage"];
}

/** Renders the coordinator chat pane over a fake chat host and a live projects stub, and starts it. */
export const setup = (options: PaneOptions = {}) => {
  const fake = createFakeEvents();
  const seen = memorySeenStore(options.seen);
  const pending = [...(options.fetches ?? [Promise.resolve([])])];
  const sent: string[] = [];
  const project = options.project ?? makeProject({ id: "prj_1" });
  const chat = createProjectChat({
    projectId: "prj_1",
    api: {
      listMessages: options.listMessages ?? (() => pageFrom(pending)),
      sendMessage:
        options.sendMessage ??
        (async (_id, text) => {
          sent.push(text);
          return userMessage("sent", 30, { text });
        }),
    },
    events: fake.events,
    seen,
  });
  const stub = stubLiveProjects(makeState([makeEntry(project, options.threads ?? [])]));
  render(
    <ProjectsProvider live={stub.live}>
      <Harness chat={chat} project={project} threads={options.threads ?? []} />
    </ProjectsProvider>,
  );
  act(() => chat.start());
  return { fake, seen, sent, chat, stub };
};

export const settled = () => act(async () => {});
export const type = (text: string) =>
  fireEvent.change(screen.getByTestId("composer-input"), { target: { value: text } });
export const pressEnter = () =>
  fireEvent.keyDown(screen.getByTestId("composer-input"), { key: "Enter" });
