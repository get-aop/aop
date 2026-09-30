import { type Api, createApi } from "./api.ts";
import { type HostDb, openHostDb, type RunRow, type SessionRow } from "./host-db.ts";
import { readLedger, summarizeLedger } from "./ledger.ts";
import { type Fields, parseEvents } from "./log-shapes.ts";
import { type GhObservation, observeGh } from "./observe-gh.ts";
import type { HarnessState, ScenarioFacts, ThreadLabel } from "./state.ts";

/**
 * Everything the checks judge, read once from the stack after the scenario: each session's runs
 * with their logs and the argv the gate saw, the threads and messages as the API shows them,
 * the usage the API reports, and what the real `gh` returned. The checks are pure functions of
 * this, so they can be tested against a log played by the fake CLI.
 */
export interface RunObservation {
  row: RunRow;
  /** The arguments the gate passed to the real `claude`, from its ledger. */
  argv: string[];
  events: Fields[];
}

export interface SessionObservation {
  label: string;
  session: SessionRow | null;
  runs: RunObservation[];
}

export interface ThreadObservation extends SessionObservation {
  thread: Record<string, unknown> | null;
  messages: Record<string, unknown>[];
  diff: unknown;
}

export interface Observed {
  facts: ScenarioFacts;
  ledger: ReturnType<typeof summarizeLedger>;
  coordinator: SessionObservation & { messages: Record<string, unknown>[]; usage: unknown };
  editCoordinator: SessionObservation;
  threads: Record<ThreadLabel, ThreadObservation>;
  projectUsage: unknown;
  watch: unknown;
  gh: GhObservation | null;
  /** Why a part could not be read, so a missing observation is a finding and not a silent pass. */
  gaps: string[];
}

export const observe = async (state: HarnessState): Promise<Observed> => {
  const api = createApi(state.api);
  const db = openHostDb(state.dbPath);
  const gaps: string[] = [];
  try {
    const ledgerEntries = readLedger(state.gateDir);
    const argvByPid = new Map(
      ledgerEntries.flatMap((entry) => (entry.event === "start" ? [[entry.pid, entry.argv]] : [])),
    );
    const sessionOf = (label: string, id: string | undefined): SessionObservation =>
      observeSession(db, argvByPid, label, id);
    const { projects, threads: ids } = state;
    const threads = {} as Observed["threads"];
    for (const label of ["pr", "ask", "browser", "edit"] as const) {
      threads[label] = await observeThread(api, sessionOf(label, ids?.[label]), gaps);
    }
    const coordinator = sessionOf("coordinator", state.coordinatorSessionId);
    const prNumber = state.facts?.pullRequestNumber ?? null;
    return {
      facts: state.facts as ScenarioFacts,
      ledger: summarizeLedger(ledgerEntries),
      coordinator: {
        ...coordinator,
        messages: await safe(
          gaps,
          "coordinator messages",
          async () =>
            (
              await api.get<{ messages: Record<string, unknown>[] }>(
                `/api/projects/${projects?.main}/messages`,
              )
            ).messages,
        ).then((messages) => messages ?? []),
        usage: await safe(gaps, "coordinator usage", () =>
          api.get(`/api/usage/threads/${state.coordinatorSessionId}`),
        ),
      },
      editCoordinator: sessionOf("editCoordinator", db.coordinatorOf(projects?.edit ?? "")?.id),
      threads,
      projectUsage: await safe(gaps, "project usage", () =>
        api.get(`/api/usage/projects/${projects?.main}`),
      ),
      watch: ids?.pr
        ? await safe(gaps, "pull request watch", () =>
            api.get(`/api/threads/${ids.pr}/pull-request/watch`),
          )
        : null,
      gh:
        (prNumber ? await safe(gaps, "gh", () => observeGh(state.repoPath, prNumber)) : null) ??
        null,
      gaps,
    };
  } finally {
    db.close();
  }
};

const observeSession = (
  db: HostDb,
  argvByPid: Map<number, string[]>,
  label: string,
  id: string | undefined,
): SessionObservation => {
  if (!id) return { label, session: null, runs: [] };
  return {
    label,
    session: db.session(id),
    runs: db.runsOf(id).map((row) => ({
      row,
      argv: (row.pid !== null ? argvByPid.get(row.pid) : undefined) ?? [],
      events: parseEvents(db.readLog(row)),
    })),
  };
};

const observeThread = async (
  api: Api,
  base: SessionObservation,
  gaps: string[],
): Promise<ThreadObservation> => {
  const id = base.session?.id;
  const get = <T>(what: string, path: string): Promise<T | undefined> =>
    id ? safe(gaps, `${base.label} ${what}`, () => api.get<T>(path)) : Promise.resolve(undefined);
  const thread = await get<{ thread: Record<string, unknown> }>("thread", `/api/threads/${id}`);
  const messages = await get<{ messages: Record<string, unknown>[] }>(
    "messages",
    `/api/threads/${id}/messages`,
  );
  return {
    ...base,
    thread: thread?.thread ?? null,
    messages: messages?.messages ?? [],
    diff: await get("diff", `/api/threads/${id}/diff`),
  };
};

const safe = async <T>(
  gaps: string[],
  what: string,
  read: () => Promise<T>,
): Promise<T | undefined> => {
  try {
    return await read();
  } catch (error) {
    gaps.push(`${what}: ${(error as Error).message}`);
    return undefined;
  }
};
