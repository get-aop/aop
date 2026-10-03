import type { HostSetup, SetupCheck, SetupCheckId } from "@aop/common";
import { getLogger } from "@aop/infra";
import { claudeCheck } from "./claude-check.ts";
import { computerUseCheck } from "./computer-use-check.ts";
import { githubCheck } from "./github-check.ts";
import type { HostFacts, HostSetupProbes, ServeLook } from "./probes.ts";
import { reachableCheck } from "./reachable-check.ts";
import { serviceCheck } from "./service-check.ts";
import { updatesCheck } from "./updates-check.ts";

const logger = getLogger("host-setup");

/** A check that has not answered by then says so, rather than holding up the whole page. */
const CHECK_TIMEOUT_MS = 12_000;

export type FixResult =
  | { ok: true; setup: HostSetup }
  | { ok: false; code: "NOT_FOUND" | "NO_FIX"; error: string }
  | { ok: false; code: "FIX_FAILED"; error: string; setup: HostSetup };

export interface HostSetupService {
  /** The checklist; `fresh` looks again instead of reusing the last few seconds' looks. */
  setup: (options?: { fresh?: boolean }) => Promise<HostSetup>;
  /** Runs the check's fix on the host, then answers the checklist as it is after it. */
  fix: (id: string) => Promise<FixResult>;
}

export interface HostSetupServiceDeps {
  probes: HostSetupProbes;
  facts: HostFacts;
  timeoutMs?: number;
}

export const createHostSetupService = (deps: HostSetupServiceDeps): HostSetupService => {
  const setup: HostSetupService["setup"] = ({ fresh = false } = {}) => readSetup(deps, fresh);

  return {
    setup,
    fix: async (id) => {
      const before = (await setup()).checks.find((check) => check.id === id);
      if (!before) return { ok: false, code: "NOT_FOUND", error: `No setup check "${id}"` };
      if (!FIXES[before.id] || !before.actions.some((action) => action.kind === "fix")) {
        return {
          ok: false,
          code: "NO_FIX",
          error: `${before.title} has nothing the host can fix itself`,
        };
      }
      try {
        const exitCode = await FIXES[before.id]?.(deps.probes);
        logger.info("Setup fix {id} finished with exit code {exitCode}", { id, exitCode });
        return { ok: true, setup: await setup({ fresh: true }) };
      } catch (error) {
        logger.error("Setup fix {id} failed: {error}", { id, error: messageOf(error) });
        return {
          ok: false,
          code: "FIX_FAILED",
          error: messageOf(error),
          setup: await setup({ fresh: true }),
        };
      }
    },
  };
};

/** The checks the host can fix by itself, and how. */
const FIXES: Partial<Record<SetupCheckId, (probes: HostSetupProbes) => Promise<number>>> = {
  "computer-use": (probes) => probes.setupComputerUse(),
};

const readSetup = async (deps: HostSetupServiceDeps, fresh: boolean): Promise<HostSetup> => {
  const { probes, facts } = deps;
  const host = facts.hostName;
  const timeoutMs = deps.timeoutMs ?? CHECK_TIMEOUT_MS;
  const bounded = <T>(
    id: SetupCheckId,
    look: () => Promise<T>,
    toCheck: (value: T) => SetupCheck,
  ) => withTimeout(look(), timeoutMs).then(toCheck, (error) => unchecked(id, error));

  // One look serves both the check and the addresses the header lists.
  const serve = withTimeout(probes.serve(), timeoutMs);
  const checks = await Promise.all([
    bounded("service", probes.service, (look) => serviceCheck(look, facts.channel, host)),
    bounded(
      "reachable",
      () => serve,
      (look) => reachableCheck(look, facts.port, host, facts.channel),
    ),
    bounded(
      "claude",
      () => probes.claude(fresh),
      (look) => claudeCheck(look, host),
    ),
    bounded(
      "github",
      () => probes.github(fresh),
      (auth) => githubCheck(auth, host),
    ),
    bounded(
      "computer-use",
      () => probes.computerUse(fresh),
      (look) => computerUseCheck(look, `${facts.channel.binaryName} computer-use setup`),
    ),
    bounded("updates", probes.updates, (look) => updatesCheck(look, facts.channel)),
  ]);

  const counted = checks.filter((check) => check.state !== "optional");
  return {
    hostName: host,
    os: facts.os,
    channel: facts.channel.id,
    version: facts.version,
    uptimeSeconds: Math.round(facts.uptimeSeconds()),
    addresses: await addressesOf(serve),
    checks,
    ready: counted.filter((check) => check.state === "ok").length,
    total: counted.length,
  };
};

const addressesOf = (serve: Promise<ServeLook>): Promise<string[]> =>
  serve.then(
    (look) => look.addresses,
    () => [],
  );

const TITLES: Record<SetupCheckId, string> = {
  service: "Runs as a service",
  reachable: "Reachable from your other devices",
  claude: "Claude Code",
  github: "GitHub",
  "computer-use": "Computer use",
  updates: "Updates",
};

// A look that failed or took too long is reported, not taken for a problem it may not be.
const unchecked = (id: SetupCheckId, error: unknown): SetupCheck => {
  logger.warn("Setup check {id} could not look: {error}", { id, error: messageOf(error) });
  return {
    id,
    state: "warning",
    title: TITLES[id],
    detail: `Couldn't check: ${messageOf(error)}`,
    actions: [],
  };
};

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
