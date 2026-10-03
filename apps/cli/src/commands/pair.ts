import { buildChannel, type HostSetup, type PairingCode, PairingCodeSchema } from "@aop/common";
import { fetchServer, getServerUrl } from "./client.ts";

/** How long `aop pair` waits for the host's addresses before printing the code without them. */
const ADDRESSES_TIMEOUT_MS = 15_000;

export interface PairDeps {
  request: typeof fetchServer;
  print: (line: string) => void;
  now: () => Date;
  serverUrl: string;
  binaryName: string;
}

/**
 * `aop pair` (`aop-nightly pair` on AOP Nightly): asks the host on this computer for a one-time
 * pairing code and prints it with where to enter it. It talks to the host over loopback, which
 * makes it the host owner, so it needs no token of its own. Answers the exit code.
 */
export const pairCommand = async (deps: PairDeps = defaultPairDeps()): Promise<number> => {
  const grant = await issueCode(deps);
  if (!grant.ok) {
    deps.print(grant.message);
    return 1;
  }
  const minutes = Math.max(
    1,
    Math.round((Date.parse(grant.code.expiresAt) - deps.now().getTime()) / 60_000),
  );
  deps.print(`Pairing code: ${grant.code.code} (expires in ${minutes} min)`);
  for (const line of whereToEnter(await readSetup(deps))) deps.print(line);
  return 0;
};

type Grant = { ok: true; code: PairingCode } | { ok: false; message: string };

const issueCode = async (deps: PairDeps): Promise<Grant> => {
  try {
    const result = await deps.request<unknown>("/api/auth/pairing-codes", { method: "POST" });
    if (!result.ok) {
      return { ok: false, message: `Couldn't make a pairing code: ${result.error.error}` };
    }
    return { ok: true, code: PairingCodeSchema.parse(result.data) };
  } catch {
    return {
      ok: false,
      message: `No AOP host answers at ${deps.serverUrl}. Start it with \`${deps.binaryName} run\` (or start its service), then run \`${deps.binaryName} pair\` again.`,
    };
  }
};

// A host from before the setup checklist, or one slow to answer, still gets its code printed.
const readSetup = async (deps: PairDeps): Promise<HostSetup | null> => {
  try {
    const result = await deps.request<HostSetup>("/api/host/setup", {
      signal: AbortSignal.timeout(ADDRESSES_TIMEOUT_MS),
    });
    return result.ok ? result.data : null;
  } catch {
    return null;
  }
};

const whereToEnter = (setup: HostSetup | null): string[] => {
  const [first, ...others] = setup?.addresses ?? [];
  if (first) {
    const also = others.length > 0 ? ` (or ${others.join(", ")})` : "";
    return [`Enter it in the AOP app or a browser at ${first}${also}`];
  }
  if (!setup) return ["Enter it in the AOP app or a browser at this host's address."];
  const reachable = setup.checks.find((check) => check.id === "reachable");
  const howTo = reachable?.actions.find((action) => action.kind === "how-to");
  return [
    "Enter it in the AOP app or a browser at this host's address.",
    `Only this computer can reach ${setup.hostName} now.${
      howTo?.command ? ` To reach it from your other devices, run: ${howTo.command}` : ""
    }`,
  ];
};

const defaultPairDeps = (): PairDeps => ({
  request: fetchServer,
  print: (line) => process.stdout.write(`${line}\n`),
  now: () => new Date(),
  serverUrl: getServerUrl(),
  binaryName: buildChannel().binaryName,
});
