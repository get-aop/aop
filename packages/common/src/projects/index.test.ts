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
      "DeviceSchema",
      "EventLogEntrySchema",
      "getThreadProgress",
      "MessageBlockSchema",
      "MessageSchema",
      "NotificationLevelSchema",
      "PairDeviceRequestSchema",
      "PairedDeviceSchema",
      "PairingCodeSchema",
      "ProjectPatchSchema",
      "ProjectSchema",
      "ProjectSettingsSchema",
      "ProjectStatusSchema",
      "ReasoningEffortSchema",
      "RuntimePreferenceSchema",
      "RuntimeSelectionSchema",
      "THREAD_STATUSES",
      "ThreadSchema",
      "UserMessageSchema",
    ]),
  );
  expect(common.ProjectSchema.safeParse(makeProject()).success).toBe(true);
});
