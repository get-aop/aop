import type { CheckResult, CheckStatus } from "./check-types.ts";
import {
  coordinatorRestricted,
  coordinatorSpawnAndChips,
  systemPromptOnResume,
} from "./checks-coordinator.ts";
import { autoFixOnRealCheck, ghShapes, pullRequestOpened } from "./checks-github.ts";
import { modelAndEffort, rateLimitShapes, usageShapes } from "./checks-runtime.ts";
import { threadToolsPinned } from "./checks-thread-tools.ts";
import {
  askUserAndResume,
  browserAnswerApplied,
  defaultThreadFullAccess,
  editFilesThreadDenied,
} from "./checks-threads.ts";
import type { Observed } from "./observe.ts";

const CHECKS: ((observed: Observed) => CheckResult)[] = [
  modelAndEffort,
  coordinatorRestricted,
  coordinatorSpawnAndChips,
  defaultThreadFullAccess,
  pullRequestOpened,
  editFilesThreadDenied,
  askUserAndResume,
  threadToolsPinned,
  systemPromptOnResume,
  usageShapes,
  rateLimitShapes,
  ghShapes,
  autoFixOnRealCheck,
  browserAnswerApplied,
];

// The focused scenario runs one thread, so only the checks about it have anything to judge.
const TOOLS_SCENARIO_CHECKS = [modelAndEffort, threadToolsPinned, usageShapes, rateLimitShapes];

/** A check that throws is a failed check, not a crash: the rest of the report still gets written. */
export const evaluate = (observed: Observed): CheckResult[] =>
  (observed.facts.scenario === "tools" ? TOOLS_SCENARIO_CHECKS : CHECKS).map((check) => {
    try {
      return check(observed);
    } catch (error) {
      return {
        id: check.name,
        title: check.name,
        status: "fail" as CheckStatus,
        summary: `the check itself failed: ${(error as Error).message}`,
        details: [],
      };
    }
  });
