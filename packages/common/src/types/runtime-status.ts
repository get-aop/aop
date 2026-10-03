import { z } from "zod";
import { RuntimeIdSchema } from "../projects/runtime.ts";

/**
 * Whether a runtime's command is logged in, as far as the host can tell without asking the
 * person anything: Claude Code answers `auth status`; a command that does not answer is unknown.
 */
export type RuntimeAuthState = "logged-in" | "logged-out" | "unknown";

/**
 * What the host found for one runtime configuration the last time it looked. A runtime is ready
 * when its command is found and is not known to be logged out; an unknown login does not block,
 * since a wrapper may not answer `auth status` and still run turns.
 */
export interface RuntimeStatus {
  runtimeId: string;
  /** Where the command resolves on the host's PATH; null when it is not found. */
  path: string | null;
  /** What `<command> --version` printed; null when it printed nothing usable. */
  version: string | null;
  auth: RuntimeAuthState;
  ready: boolean;
  /** Why it is not ready, in words for the person; null when it is. */
  reason: string | null;
  checkedAt: string;
}

/** A project that uses a runtime, and how: the reason a runtime cannot simply be removed. */
export interface RuntimeUsage {
  projectId: string;
  projectName: string;
  /** Which of the project's settings name it. */
  roles: ("coordinator" | "threads")[];
  /** Threads that are not resolved and started on it: they keep a runtime for their whole life. */
  openThreads: number;
}

/** The body of `PUT /api/runtime-configuration/default`. */
export const DefaultRuntimeInputSchema = z.object({ runtimeId: RuntimeIdSchema });
