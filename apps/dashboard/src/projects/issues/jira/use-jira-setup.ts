import {
  JIRA_NOT_CONNECTED,
  type JiraAccount,
  type JiraConnection,
  type JiraCredentials,
  type JiraFilter,
  type JiraProjectSummary,
} from "@aop/common";
import { useCallback, useEffect, useState } from "react";
import {
  connectJira,
  disconnectJira,
  getJiraConnection,
  testJiraConnection,
} from "../../../api/jira";
import { ApiError } from "../../../api/request";

export type JiraSetupStep =
  /** Reading the connection. */
  | { kind: "loading" }
  | { kind: "connected" }
  /** Asking for the site and a token: a first connection, or a new token for one. */
  | { kind: "credentials" }
  /**
   * Picking which issues show, with the projects the credentials see. `credentials` is null
   * when the stored ones stay (a new filter for the same connection).
   */
  | {
      kind: "filter";
      account: JiraAccount;
      projects: JiraProjectSummary[];
      credentials: JiraCredentials | null;
    };

/** What the last Test connection found: who the token signs in as, or why it did not. */
export type JiraTestOutcome =
  | { ok: true; account: JiraAccount; projects: JiraProjectSummary[]; tested: string }
  | { ok: false; message: string; refused: boolean };

export interface JiraSetup {
  connection: JiraConnection | null;
  step: JiraSetupStep;
  busy: boolean;
  error: string | null;
  test: JiraTestOutcome | null;
  /** Signs in with the credentials typed (or the stored ones), and shows who they are. */
  testConnection: (credentials?: JiraCredentials) => Promise<void>;
  /** Moves on to picking the filter with the credentials Test connection signed in with. */
  continueWithTested: (credentials: JiraCredentials) => void;
  /** Picks a new filter for the stored credentials. */
  changeFilter: () => Promise<void>;
  replaceToken: () => void;
  save: (filter: JiraFilter, linkPullRequests: boolean) => Promise<boolean>;
  disconnect: () => Promise<boolean>;
  back: () => void;
}

/**
 * The steps of connecting a project to Jira, while the dialog is open. The token the person
 * types goes to the host to be tried and, once, to be saved; the host never sends it back, so a
 * stored token is never in this state.
 */
export const useJiraSetup = (projectId: string, open: boolean): JiraSetup => {
  const [connection, setConnection] = useState<JiraConnection | null>(null);
  const [step, setStep] = useState<JiraSetupStep>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<JiraTestOutcome | null>(null);

  useEffect(() => {
    if (!open) return;
    let current = true;
    setStep({ kind: "loading" });
    setError(null);
    setTest(null);
    getJiraConnection(projectId).then(
      (read) => {
        if (!current) return;
        setConnection(read);
        setStep({ kind: read.configured ? "connected" : "credentials" });
      },
      (cause) => {
        if (!current) return;
        setError(messageOf(cause));
        setStep({ kind: "credentials" });
      },
    );
    return () => {
      current = false;
    };
  }, [projectId, open]);

  const run = useCallback(async <T>(work: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await work();
    } catch (cause) {
      setError(messageOf(cause));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    connection,
    step,
    busy,
    error,
    test,
    testConnection: async (credentials) => {
      setBusy(true);
      setError(null);
      setTest(null);
      try {
        const result = await testJiraConnection(projectId, credentials);
        setTest({ ok: true, ...result, tested: credentials ? fingerprint(credentials) : "" });
      } catch (cause) {
        setTest({ ok: false, message: messageOf(cause), refused: isRefused(cause) });
      } finally {
        setBusy(false);
      }
    },
    continueWithTested: (credentials) => {
      if (test?.ok !== true) return;
      setError(null);
      setStep({ kind: "filter", account: test.account, projects: test.projects, credentials });
    },
    changeFilter: async () => {
      const result = await run(() => testJiraConnection(projectId));
      if (result) setStep({ kind: "filter", ...result, credentials: null });
    },
    replaceToken: () => {
      setError(null);
      setTest(null);
      setStep({ kind: "credentials" });
    },
    save: async (filter, linkPullRequests) => {
      const credentials = step.kind === "filter" ? step.credentials : null;
      const saved = await run(() =>
        connectJira(projectId, { credentials: credentials ?? undefined, filter, linkPullRequests }),
      );
      if (!saved) return false;
      setConnection(saved);
      setTest(null);
      setStep({ kind: "connected" });
      return true;
    },
    disconnect: async () => {
      const done = await run(async () => {
        await disconnectJira(projectId);
        return true;
      });
      if (!done) return false;
      setConnection(JIRA_NOT_CONNECTED);
      setTest(null);
      setStep({ kind: "credentials" });
      return true;
    },
    back: () => {
      setError(null);
      setTest(null);
      setStep({ kind: connection?.configured ? "connected" : "credentials" });
    },
  };
};

/** Which credentials a test signed in with, so Continue is only offered for those. */
export const fingerprint = (credentials: JiraCredentials): string => JSON.stringify(credentials);

const isRefused = (cause: unknown): boolean =>
  cause instanceof ApiError && cause.code === "JIRA_UNAUTHORIZED";

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);
