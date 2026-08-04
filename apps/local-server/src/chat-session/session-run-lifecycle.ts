export type InterruptReason = "steer" | "abort" | "reset" | "output_limit";

/** Phases for in-process session ownership. Recovered durable rows are not modelled here. */
export type ActiveRunPhase = "pending" | "spawning" | "running" | "cancelling";

export interface ActiveRunOwner {
  token: symbol;
  runtime: string;
  interrupted: boolean;
  interruptReason: InterruptReason;
  interruptedDuringTool: boolean;
  releaseRequested: boolean;
  executions: Set<ActiveRunHandle>;
}

export interface ActiveRunHandle {
  owner: ActiveRunOwner;
  phase: Exclude<ActiveRunPhase, "pending">;
  kill: () => void;
  interruptSignal: NodeJS.Signals;
  logToolActive: boolean;
  nativeToolActive: boolean;
  pidReady: Promise<number>;
  resolvePid: (pid: number) => void;
  pid?: number;
}

export interface SessionRunRegistration {
  sessionId: string;
  token: symbol;
}

export interface SessionRunExecution {
  owner: ActiveRunOwner;
  handle: ActiveRunHandle;
  preservesRegistration: boolean;
}

const activeRuns = new Map<string, ActiveRunOwner>();

export const isSessionRunActive = (sessionId: string): boolean => activeRuns.has(sessionId);

export const ownsSessionRunRegistration = (registration: SessionRunRegistration): boolean =>
  activeRuns.get(registration.sessionId)?.token === registration.token;

export const sessionRunPhase = (sessionId: string): ActiveRunPhase | null => {
  const owner = activeRuns.get(sessionId);
  if (!owner) return null;
  if (owner.interrupted) return "cancelling";
  if ([...owner.executions].some((execution) => execution.phase === "running")) return "running";
  if (owner.executions.size > 0) return "spawning";
  return "pending";
};

/** Register accepted reply work before any provider-preparation awaits. */
export const registerPendingSessionRun = (
  sessionId: string,
  runtime: string,
): SessionRunRegistration | null => {
  if (activeRuns.has(sessionId)) return null;
  const owner = createActiveRunOwner(runtime);
  activeRuns.set(sessionId, owner);
  return { sessionId, token: owner.token };
};

export const releaseSessionRunRegistration = (registration: SessionRunRegistration): void => {
  const owner = activeRuns.get(registration.sessionId);
  if (owner?.token !== registration.token) return;
  if (owner.executions.size > 0) {
    owner.releaseRequested = true;
    return;
  }
  activeRuns.delete(registration.sessionId);
};

export const activeSessionRunIds = (): string[] => [...activeRuns.keys()];

export const isSessionToolActive = (sessionId: string): boolean => {
  const owner = activeRuns.get(sessionId);
  return Boolean(
    owner &&
      [...owner.executions].some(
        (execution) => execution.logToolActive || execution.nativeToolActive,
      ),
  );
};

/** Interrupt pending, spawning, or running work owned by this process. */
export const interruptSessionRun = (
  sessionId: string,
  interruptReason: InterruptReason = "steer",
): boolean => {
  const owner = activeRuns.get(sessionId);
  if (!owner) return false;
  interruptRunOwner(owner, interruptReason);
  return true;
};

export const interruptRunOwner = (owner: ActiveRunOwner, reason: InterruptReason): void => {
  if (owner.interrupted) return;
  owner.interrupted = true;
  owner.interruptReason = reason;
  owner.interruptedDuringTool = [...owner.executions].some(
    (execution) => execution.logToolActive || execution.nativeToolActive,
  );
  for (const execution of owner.executions) {
    execution.phase = "cancelling";
    try {
      execution.kill();
    } catch {
      // Process may already have exited.
    }
  }
};

export const beginSessionRunExecution = (
  sessionId: string,
  runtime: string,
  registration?: SessionRunRegistration,
): SessionRunExecution | null => {
  const registeredOwner = resolveRegisteredOwner(registration, sessionId);
  if (activeRuns.has(sessionId) && !registeredOwner) return null;

  const owner = registeredOwner ?? createActiveRunOwner(runtime);
  if (!registeredOwner) activeRuns.set(sessionId, owner);
  const handle = createActiveRunHandle(owner, owner.interrupted ? "cancelling" : "spawning");
  owner.executions.add(handle);
  return { owner, handle, preservesRegistration: Boolean(registeredOwner) };
};

export const releaseSessionRunExecution = (
  sessionId: string,
  execution: SessionRunExecution,
): void => {
  const { owner, handle, preservesRegistration } = execution;
  owner.executions.delete(handle);
  if (activeRuns.get(sessionId) !== owner || owner.executions.size > 0) return;
  if (preservesRegistration && !owner.releaseRequested) return;
  activeRuns.delete(sessionId);
};

export const isSessionRunInterrupted = (sessionId: string): boolean =>
  Boolean(activeRuns.get(sessionId)?.interrupted);

const createActiveRunOwner = (runtime: string): ActiveRunOwner => ({
  token: Symbol("chat-session-run"),
  runtime,
  interrupted: false,
  interruptReason: "steer",
  interruptedDuringTool: false,
  releaseRequested: false,
  executions: new Set(),
});

const createActiveRunHandle = (
  owner: ActiveRunOwner,
  phase: Exclude<ActiveRunPhase, "pending">,
): ActiveRunHandle => {
  let resolvePid = (_pid: number): void => {};
  const pidReady = new Promise<number>((resolve) => {
    resolvePid = resolve;
  });
  return {
    owner,
    phase,
    interruptSignal: "SIGTERM",
    logToolActive: false,
    nativeToolActive: false,
    pidReady,
    resolvePid,
    kill: () => {},
  };
};

const resolveRegisteredOwner = (
  registration: SessionRunRegistration | undefined,
  sessionId: string,
): ActiveRunOwner | null => {
  if (!registration || registration.sessionId !== sessionId) return null;
  const owner = activeRuns.get(sessionId);
  return owner?.token === registration.token ? owner : null;
};
