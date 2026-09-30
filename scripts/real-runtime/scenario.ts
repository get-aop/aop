import { type Api, createApi } from "./api.ts";
import { type HostDb, openHostDb } from "./host-db.ts";
import {
  ASK_THREAD_PROMPT,
  ASK_THREAD_TITLE,
  BROWSER_THREAD_PROMPT,
  BROWSER_THREAD_TITLE,
  coordinatorFirstMessage,
  coordinatorSecondMessage,
  EDIT_THREAD_PROMPT,
  EDIT_THREAD_TITLE,
  INSTRUCTIONS_WITH_CODEWORD,
  PR_THREAD_TITLE,
} from "./prompts.ts";
import { waitFor } from "./shell.ts";
import { type HarnessState, type ScenarioFacts, saveState, type ThreadLabel } from "./state.ts";

/**
 * The scripted session against the real runtime: a coordinator turn that starts a thread, three
 * more threads started through the API (one that asks and is answered here, one that asks and is
 * left for the browser, one on an Edit files project), the pull request of the first thread
 * failing its check on purpose, and a second coordinator turn after the project instructions
 * changed. It only drives and waits; what it proves is decided from the logs afterwards.
 */
export const MODEL = { provider: "claude-code", model: "sonnet", effort: "medium" } as const;
const MINUTE = 60_000;

interface ThreadJson {
  id: string;
  title: string;
  status: string;
  artifacts: { type: string; number?: number; url?: string; checks?: { state: string } }[];
}

export const runScenario = async (
  state: HarnessState,
  say: (line: string) => void,
): Promise<HarnessState> => {
  const api = createApi(state.api);
  const db = openHostDb(state.dbPath);
  const facts: ScenarioFacts = {
    pullRequestNumber: null,
    pullRequestUrl: null,
    startedAt: new Date().toISOString(),
    notes: [],
  };
  state.facts = facts;
  // A step that times out is noted and the rest still runs: the checks judge what exists.
  const step = async <T>(label: string, run: () => Promise<T>): Promise<T | undefined> => {
    say(label);
    try {
      return await run();
    } catch (error) {
      facts.notes.push(`${label}: ${(error as Error).message}`);
      say(`  failed: ${(error as Error).message}`);
      return undefined;
    }
  };
  try {
    const projects = await createProjects(api, state.repoId);
    state.projects = projects;
    state.coordinatorSessionId = db.coordinatorOf(projects.main)?.id;
    await saveState(state);

    await step("coordinator turn 1: restricted tools, start the pull request thread", () =>
      api.post(`/api/projects/${projects.main}/messages`, { text: coordinatorFirstMessage() }),
    );
    // One failed run says the plumbing is wrong; stop before spending on the rest.
    const first = await step("waiting for the first real run to end", () =>
      waitForFirstRun(db, state.coordinatorSessionId, 6 * MINUTE),
    );
    if (first !== "completed") {
      facts.notes.push(
        `aborted: the first real run ended ${first ?? "unknown"}; no more runs started`,
      );
      await saveState(state);
      return state;
    }
    const side = await startSideThreads(api, state, projects);
    const pr = await step("waiting for the coordinator to start the pull request thread", () =>
      waitForThread(api, projects.main, PR_THREAD_TITLE, 4 * MINUTE),
    );
    state.threads = { ...side, pr: pr?.id ?? "" };
    await saveState(state);
    if (pr) await watchPullRequest(step, api, pr.id, facts);

    await step("answering the ask thread through the API", async () => {
      await waitForStatus(api, side.ask, "waiting-on-you", 5 * MINUTE);
      await api.post(`/api/threads/${side.ask}/reply`, { text: "formal" });
    });
    await step("waiting for the browser thread's question", () =>
      waitForStatus(api, side.browser, "waiting-on-you", 5 * MINUTE),
    );
    await step("waiting for the host to go quiet", () => settle(db, 10 * MINUTE));

    await step("coordinator turn 2: edited instructions on a resumed session", async () => {
      await api.patch(`/api/projects/${projects.main}`, {
        instructions: INSTRUCTIONS_WITH_CODEWORD,
      });
      const sent = await api.post<{ message: { id: string } }>(
        `/api/projects/${projects.main}/messages`,
        { text: coordinatorSecondMessage() },
      );
      facts.codewordMessageId = sent.message.id;
      await settle(db, 5 * MINUTE);
    });
    facts.finishedAt = new Date().toISOString();
    await saveState(state);
    return state;
  } finally {
    db.close();
  }
};

const watchPullRequest = async (
  step: <T>(label: string, run: () => Promise<T>) => Promise<T | undefined>,
  api: Api,
  threadId: string,
  facts: ScenarioFacts,
): Promise<void> => {
  const pr = await step("waiting for the thread's pull request", () =>
    waitForPullRequest(api, threadId, 8 * MINUTE),
  );
  facts.pullRequestNumber = pr?.number ?? null;
  facts.pullRequestUrl = pr?.url ?? null;
  if (pr) {
    await step("waiting for the failing check and the watcher's fix prompt", () =>
      waitForFixPrompt(api, threadId, 8 * MINUTE),
    );
    await step("waiting for the fixed pull request's checks to pass", () =>
      waitForChecks(api, threadId, "success", 6 * MINUTE),
    );
  }
};

const createProjects = async (
  api: Api,
  repoId: string,
): Promise<{ main: string; edit: string }> => {
  const base = { repoIds: [repoId], coordinator: MODEL, thread: MODEL };
  const main = await api.post<{ project: { id: string } }>("/api/projects", {
    ...base,
    name: "Real runtime",
    goal: "A small scratch project for checking the real runtime.",
  });
  const edit = await api.post<{ project: { id: string } }>("/api/projects", {
    ...base,
    name: "Real runtime, Edit files",
    threadAccess: "auto-accept-edits",
  });
  return { main: main.project.id, edit: edit.project.id };
};

const startSideThreads = async (
  api: Api,
  state: HarnessState,
  projects: { main: string; edit: string },
): Promise<Record<Exclude<ThreadLabel, "pr">, string>> => {
  const start = async (projectId: string, title: string, prompt: string): Promise<string> => {
    const { thread } = await api.post<{ thread: { id: string } }>(
      `/api/projects/${projectId}/threads`,
      {
        title,
        prompt,
        repoId: state.repoId,
      },
    );
    return thread.id;
  };
  return {
    ask: await start(projects.main, ASK_THREAD_TITLE, ASK_THREAD_PROMPT),
    browser: await start(projects.main, BROWSER_THREAD_TITLE, BROWSER_THREAD_PROMPT),
    edit: await start(projects.edit, EDIT_THREAD_TITLE, EDIT_THREAD_PROMPT),
  };
};

const waitForFirstRun = (db: HostDb, sessionId: string | undefined, timeoutMs: number) =>
  waitFor(
    "the coordinator's first run to end",
    () => {
      const run = sessionId ? db.runsOf(sessionId)[0] : undefined;
      return run && run.status !== "running" ? run.status : undefined;
    },
    { timeoutMs, everyMs: 2000 },
  );

const getThread = async (api: Api, id: string): Promise<ThreadJson> =>
  (await api.get<{ thread: ThreadJson }>(`/api/threads/${id}`)).thread;

const waitForThread = (
  api: Api,
  projectId: string,
  title: string,
  timeoutMs: number,
): Promise<ThreadJson> =>
  waitFor(
    `a thread titled "${title}"`,
    async () => {
      const { threads } = await api.get<{ threads: ThreadJson[] }>(
        `/api/projects/${projectId}/threads`,
      );
      return threads.find((thread) => thread.title === title);
    },
    { timeoutMs },
  );

export const waitForStatus = (
  api: Api,
  id: string,
  status: string,
  timeoutMs: number,
): Promise<ThreadJson> =>
  waitFor(
    `thread ${id} to be ${status}`,
    async () => {
      const thread = await getThread(api, id);
      return thread.status === status ? thread : undefined;
    },
    { timeoutMs },
  );

const waitForPullRequest = async (
  api: Api,
  id: string,
  timeoutMs: number,
): Promise<{ number: number; url: string }> =>
  waitFor(
    `thread ${id} to open a pull request`,
    async () => {
      const pr = (await getThread(api, id)).artifacts.find((artifact) => artifact.type === "pr");
      return pr?.number && pr.url ? { number: pr.number, url: pr.url } : undefined;
    },
    { timeoutMs },
  );

const waitForChecks = (api: Api, id: string, state: string, timeoutMs: number): Promise<string> =>
  waitFor(
    `the checks of thread ${id} to be ${state}`,
    async () => {
      const pr = (await getThread(api, id)).artifacts.find((artifact) => artifact.type === "pr");
      return pr?.checks?.state === state ? state : undefined;
    },
    { timeoutMs },
  );

/** The watcher's message arrives as a user message starting with "Automatic fix". */
const waitForFixPrompt = (api: Api, id: string, timeoutMs: number): Promise<string> =>
  waitFor(
    `the watcher's fix prompt for thread ${id}`,
    async () => {
      const { messages } = await api.get<{ messages: { role: string; text?: string }[] }>(
        `/api/threads/${id}/messages`,
      );
      return messages.find((m) => m.role === "user" && m.text?.startsWith("Automatic fix"))?.text;
    },
    { timeoutMs },
  );

/** Nothing running or queued for a while: every reply and every report has been answered. */
const settle = async (db: HostDb, timeoutMs: number): Promise<void> => {
  let quietSince: number | null = null;
  await waitFor(
    "the host to go quiet",
    () => {
      if (db.activeCount() > 0) {
        quietSince = null;
        return undefined;
      }
      quietSince ??= Date.now();
      return Date.now() - quietSince >= 20_000 ? true : undefined;
    },
    { timeoutMs, everyMs: 2000 },
  );
};
