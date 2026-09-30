import { createApi } from "./api.ts";
import { openHostDb } from "./host-db.ts";
import { ASK_THREAD_PROMPT, ASK_THREAD_TITLE } from "./prompts.ts";
import { MODEL, waitForStatus } from "./scenario.ts";
import { type HarnessState, saveState } from "./state.ts";

const MINUTE = 60_000;

/**
 * The focused scenario for a thread's tools: one project, one thread told to ask a question with
 * `aop_ask_user`, left waiting for the browser to answer it. That is one real run before the
 * answer and one after it (the resume), and nothing else: no coordinator turn, no pull request.
 * What it shows is decided from the logs by `threadToolsPinned`.
 */
export const runToolsScenario = async (
  state: HarnessState,
  say: (line: string) => void,
): Promise<HarnessState> => {
  const api = createApi(state.api);
  const db = openHostDb(state.dbPath);
  const facts = { pullRequestNumber: null, pullRequestUrl: null, scenario: "tools" as const };
  state.facts = { ...facts, startedAt: new Date().toISOString(), notes: [] };
  try {
    say("creating the project and the thread that asks a question");
    const created = await api.post<{ project: { id: string } }>("/api/projects", {
      name: "Real runtime, thread tools",
      goal: "A small scratch project for checking a thread's tools on the real runtime.",
      repoIds: [state.repoId],
      coordinator: MODEL,
      thread: MODEL,
    });
    state.projects = { main: created.project.id, edit: "" };
    state.coordinatorSessionId = db.coordinatorOf(created.project.id)?.id;
    const { thread } = await api.post<{ thread: { id: string } }>(
      `/api/projects/${created.project.id}/threads`,
      { title: ASK_THREAD_TITLE, prompt: ASK_THREAD_PROMPT, repoId: state.repoId },
    );
    state.threads = { pr: "", ask: thread.id, browser: "", edit: "" };
    await saveState(state);

    say("waiting for the thread's question");
    try {
      await waitForStatus(api, thread.id, "waiting-on-you", 5 * MINUTE);
    } catch (error) {
      state.facts.notes.push(`waiting for the thread's question: ${(error as Error).message}`);
    }
    state.facts.finishedAt = new Date().toISOString();
    await saveState(state);
    return state;
  } finally {
    db.close();
  }
};
