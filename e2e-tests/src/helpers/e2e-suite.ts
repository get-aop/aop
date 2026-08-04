import { describe } from "bun:test";

/** E2E suites are opt-in. Run via `bun run test:e2e` (sets AOP_RUN_E2E=1) or CI e2e workflows. */
export const shouldRunE2ESuite = (): boolean => process.env.AOP_RUN_E2E === "1";

export const e2eDescribe = shouldRunE2ESuite() ? describe : describe.skip;
