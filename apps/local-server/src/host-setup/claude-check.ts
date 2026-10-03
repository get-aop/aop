import type { SetupAction, SetupCheck } from "@aop/common";
import type { ClaudeLook } from "./probes.ts";

const RUNTIMES_LINK: SetupAction = { kind: "link", label: "Runtimes", target: "runtimes" };
const INSTALL_COMMAND = "curl -fsSL https://claude.ai/install.sh | bash";

/**
 * "Claude Code ready": the built-in runtime, as the runtime picker judges it (the same look a
 * turn takes before it starts, runtime-configuration/readiness.ts).
 */
export const claudeCheck = (look: ClaudeLook | null, host: string): SetupCheck => {
  const status = look?.status;
  if (!status?.path) return notInstalled(host);
  if (status.auth === "logged-out") return loggedOut(host);
  const parts = [
    status.version ?? "Installed",
    ...(status.auth === "logged-in" ? ["logged in"] : []),
  ].join(", ");
  return {
    id: "claude",
    state: "ok",
    title: "Claude Code ready",
    detail: look?.isDefault ? `${parts} · default runtime` : parts,
    actions: [RUNTIMES_LINK],
  };
};

const notInstalled = (host: string): SetupCheck => ({
  id: "claude",
  state: "error",
  title: "Claude Code",
  detail: `Not installed on ${host}.`,
  actions: [
    {
      kind: "how-to",
      steps: [
        `On ${host}, install Claude Code with its native installer, then run claude and use /login.`,
      ],
      command: INSTALL_COMMAND,
    },
    RUNTIMES_LINK,
  ],
});

const loggedOut = (host: string): SetupCheck => ({
  id: "claude",
  state: "error",
  title: "Claude Code",
  detail: `Not logged in. Run claude on ${host} and use /login.`,
  actions: [
    {
      kind: "how-to",
      steps: [`On ${host}, run claude in a terminal and use /login.`],
      command: "claude",
    },
    RUNTIMES_LINK,
  ],
});
