import { expect, test } from "bun:test";
import * as common from "../index.ts";
import { makeProject } from "./test-utils.ts";

test("the package index exports the projects contract", () => {
  expect(Object.keys(common)).toEqual(
    expect.arrayContaining([
      "ArtifactSchema",
      "AssistantMessageSchema",
      "AuthPrincipalSchema",
      "BlockedQuestionSchema",
      "CliProviderSchema",
      "ComputerUseInputSchema",
      "ComputerUseSchema",
      "CuaStatusSchema",
      "cuaSetupSteps",
      "CUA_COMMANDS",
      "DeviceSchema",
      "EventLogEntrySchema",
      "getThreadProgress",
      "MessageBlockSchema",
      "MessageDeltaSchema",
      "MessageSchema",
      "NotificationLevelSchema",
      "PairDeviceRequestSchema",
      "PairedDeviceSchema",
      "PairingCodeSchema",
      "ProjectPatchSchema",
      "ProjectSchema",
      "ProjectSettingsSchema",
      "ProjectStatusSchema",
      "PROJECT_STREAM_EVENTS",
      "ProjectUsageSchema",
      "ReasoningEffortSchema",
      "RuntimePreferenceSchema",
      "ResyncSchema",
      "THREAD_STATUSES",
      "ThreadSchema",
      "UsageTotalsSchema",
      "UserMessageSchema",
    ]),
  );
  expect(common.ProjectSchema.safeParse(makeProject()).success).toBe(true);
});
