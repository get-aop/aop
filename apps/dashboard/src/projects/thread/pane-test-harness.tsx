import type { Message, Project, SessionGitDiff, Thread } from "@aop/common";
import { act, render } from "@testing-library/react";
import { ConfirmationHost } from "../../components/ConfirmationHost";
import { ProjectsProvider, useProjectEntry } from "../ProjectsProvider";
import { makeEntry, makeProject, makeState, makeThread, stubLiveProjects } from "../test-utils";
import { ThreadPane } from "./ThreadPane";
import { json, type mockHost } from "./test-utils";

export const EMPTY_DIFF: SessionGitDiff = {
  defaultBranch: "main",
  files: [],
  perFileLineCap: 2000,
  summaryOnly: true,
};

/** Lets every request in flight be answered and its result drawn, inside `act`. */
export const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

export interface PaneOptions {
  project?: Project;
  thread?: Thread;
  /** Other threads of the project. */
  others?: Thread[];
  messages?: Message[];
  diff?: SessionGitDiff;
  /** Answers by `"METHOD /api/path"`, ahead of the defaults. */
  answers?: Record<string, () => Response>;
}

// The pane reads its thread from the live state, as the page does, so a status change is one `set` away.
const Harness = ({ threadId }: { threadId: string }) => {
  const entry = useProjectEntry("prj_1");
  if (!entry) return null;
  return (
    <ThreadPane
      project={entry.project}
      thread={entry.threads.find((thread) => thread.id === threadId)}
      threads={entry.threads}
      threadsLoaded={entry.threadsLoaded}
    />
  );
};

/** Renders the thread pane over a fake host that answers what the pane asks, and lets a test change what the host says. */
export const setupPane = async (host: ReturnType<typeof mockHost>, options: PaneOptions = {}) => {
  const project = options.project ?? makeProject({ id: "prj_1" });
  const initial = options.thread ?? makeThread({ id: "thr_1", projectId: "prj_1" });
  let thread = initial;
  const served = { messages: options.messages ?? [], diff: options.diff ?? EMPTY_DIFF };
  const stub = stubLiveProjects(
    makeState([makeEntry(project, [initial, ...(options.others ?? [])])]),
  );

  const base = `/api/threads/${initial.id}`;
  // What the host answers to what the pane asks on opening, by "METHOD address".
  const reads = (): Record<string, () => Response> => ({
    "GET /api/status": () =>
      json({ repos: [{ id: "repo_1", name: "checkout", path: "/work/checkout" }] }),
    [`GET ${base}/messages`]: () => json({ messages: served.messages }),
    [`GET ${base}/activity`]: () => json({ turns: [] }),
    [`GET ${base}/diff`]: () => json(served.diff),
    [`GET /api/usage/threads/${initial.id}`]: () => json({ error: "Thread not found" }, 404),
  });

  host.respondWith((request) => {
    const key = `${request.method} ${request.url}`;
    const answer = options.answers?.[key] ?? reads()[key];
    if (answer) return answer();
    if (request.method === "DELETE") return new Response(null, { status: 204 });
    // Every other call is an action on the thread, and the host answers with the thread.
    return request.method === "POST" ? json({ thread }) : json({ error: "Not found" }, 404);
  });

  render(
    <ProjectsProvider live={stub.live}>
      <Harness threadId={initial.id} />
      <ConfirmationHost />
    </ProjectsProvider>,
  );
  // Let what the pane asks for on opening (messages, repositories, usage, activity, changes) arrive.
  await flush();

  return {
    project,
    stub,
    /** The thread as the host now says it is: every component that shows it follows. */
    setThread: async (next: Thread) => {
      thread = next;
      act(() => stub.set(makeState([makeEntry(project, [next, ...(options.others ?? [])])])));
      // A new status makes the pane read usage, activity and changes again.
      await flush();
    },
    /** What `GET .../messages` answers from now on. */
    serveMessages: (messages: Message[]) => {
      served.messages = messages;
    },
  };
};
