import { describe, expect, test } from "bun:test";
import {
  buildCleanupManifests,
  type CheckpointRefRow,
  CleanupManifestError,
  parseCleanupRefsJson,
  planCleanupJobs,
  type RevertRefRow,
} from "./checkpoint-cleanup-manifest.ts";
import { revertBackupRef, runCheckpointRef } from "./test-utils.ts";

const SESSION = "csess_a";
const OTHER_SESSION = "csess_b";
const RUN = "crun_a1";
const OPERATION = "crev_a1";
const NOW = "2026-07-24T10:00:00.000Z";

describe("parseCleanupRefsJson", () => {
  test("accepts an array of non-empty ref strings", () => {
    expect(parseCleanupRefsJson('["refs/a","refs/b"]', "ctx")).toEqual(["refs/a", "refs/b"]);
    expect(parseCleanupRefsJson("[]", "ctx")).toEqual([]);
  });

  test("never degrades malformed input into an empty manifest", () => {
    for (const value of ["", "not json", "{}", '"refs/a"', "[1]", '[""]', '["  "]', "[null]"]) {
      expect(() => parseCleanupRefsJson(value, "ctx")).toThrow(CleanupManifestError);
    }
  });
});

describe("buildCleanupManifests", () => {
  test("groups refs by exact workspace identity and sorts deterministically", () => {
    const manifests = buildCleanupManifests({
      checkpoints: [
        checkpoint(RUN, { workspacePath: "/w/b" }),
        checkpoint("crun_a2", { workspacePath: "/w/a" }),
        checkpoint("crun_a3", { workspacePath: "/w/a" }),
      ],
      revertOperations: [],
      runSessionIds: new Map([
        [RUN, SESSION],
        ["crun_a2", SESSION],
        ["crun_a3", SESSION],
      ]),
    });

    expect(manifests.map((manifest) => manifest.workspacePath)).toEqual(["/w/a", "/w/b"]);
    expect(manifests[0]?.refs).toEqual([
      runCheckpointRef(SESSION, "crun_a2", "after"),
      runCheckpointRef(SESSION, "crun_a2", "before"),
      runCheckpointRef(SESSION, "crun_a3", "after"),
      runCheckpointRef(SESSION, "crun_a3", "before"),
    ]);
    expect(manifests[0]?.sessionIds).toEqual([SESSION]);
  });

  test("treats worktree root and common dir as part of the identity", () => {
    const manifests = buildCleanupManifests({
      checkpoints: [
        checkpoint(RUN, { gitCommonDir: "/repo-a/.git" }),
        checkpoint("crun_a2", { gitCommonDir: "/repo-b/.git" }),
      ],
      revertOperations: [],
      runSessionIds: new Map([
        [RUN, SESSION],
        ["crun_a2", SESSION],
      ]),
    });
    expect(manifests).toHaveLength(2);
  });

  test("attaches revert refs only to the group holding the exact target ref", () => {
    const manifests = buildCleanupManifests({
      checkpoints: [
        checkpoint(RUN, { workspacePath: "/w/a" }),
        checkpoint("crun_a2", { workspacePath: "/w/b" }),
      ],
      revertOperations: [
        revert({
          refsToDeleteJson: JSON.stringify([runCheckpointRef(SESSION, "crun_a9", "after")]),
        }),
      ],
      runSessionIds: new Map([
        [RUN, SESSION],
        ["crun_a2", SESSION],
      ]),
    });

    const target = manifests.find((manifest) => manifest.workspacePath === "/w/a");
    const other = manifests.find((manifest) => manifest.workspacePath === "/w/b");
    expect(target?.refs).toContain(revertBackupRef(SESSION, OPERATION));
    expect(target?.refs).toContain(runCheckpointRef(SESSION, "crun_a9", "after"));
    expect(other?.refs).not.toContain(revertBackupRef(SESSION, OPERATION));
  });

  test("refuses to guess an identity when only one group remains", () => {
    expect(() =>
      buildCleanupManifests({
        checkpoints: [checkpoint("crun_a2")],
        revertOperations: [revert()],
        runSessionIds: new Map([["crun_a2", SESSION]]),
      }),
    ).toThrow(/MISSING_WORKSPACE_IDENTITY|no checkpoint with an exact workspace identity/);
  });

  test("rejects refs owned by another session, run, or operation", () => {
    const cases: Array<[string, () => unknown]> = [
      [
        "cross-session checkpoint ref",
        () =>
          buildCleanupManifests({
            checkpoints: [
              { ...checkpoint(RUN), beforeRef: runCheckpointRef(OTHER_SESSION, RUN, "before") },
            ],
            revertOperations: [],
            runSessionIds: new Map([[RUN, SESSION]]),
          }),
      ],
      [
        "cross-run checkpoint ref",
        () =>
          buildCleanupManifests({
            checkpoints: [
              { ...checkpoint(RUN), afterRef: runCheckpointRef(SESSION, "crun_other", "after") },
            ],
            revertOperations: [],
            runSessionIds: new Map([[RUN, SESSION]]),
          }),
      ],
      [
        "cross-session trimmed ref",
        () =>
          buildCleanupManifests({
            checkpoints: [checkpoint(RUN)],
            revertOperations: [
              revert({
                refsToDeleteJson: JSON.stringify([
                  runCheckpointRef(OTHER_SESSION, "crun_x", "before"),
                ]),
              }),
            ],
            runSessionIds: new Map([[RUN, SESSION]]),
          }),
      ],
      [
        "cross-operation backup ref",
        () =>
          buildCleanupManifests({
            checkpoints: [checkpoint(RUN)],
            revertOperations: [
              revert({
                refsToDeleteJson: JSON.stringify([revertBackupRef(SESSION, "crev_other")]),
              }),
            ],
            runSessionIds: new Map([[RUN, SESSION]]),
          }),
      ],
      [
        "backup ref stolen from another operation",
        () =>
          buildCleanupManifests({
            checkpoints: [checkpoint(RUN)],
            revertOperations: [revert({ backupCheckpointRef: revertBackupRef(SESSION, "crev_z") })],
            runSessionIds: new Map([[RUN, SESSION]]),
          }),
      ],
      [
        "ref outside the checkpoint namespace",
        () =>
          buildCleanupManifests({
            checkpoints: [checkpoint(RUN)],
            revertOperations: [revert({ refsToDeleteJson: JSON.stringify(["refs/heads/main"]) })],
            runSessionIds: new Map([[RUN, SESSION]]),
          }),
      ],
    ];

    for (const [label, run] of cases) {
      expect(run, label).toThrow(CleanupManifestError);
    }
  });

  test("rejects a checkpoint whose owning session is not part of the plan", () => {
    expect(() =>
      buildCleanupManifests({
        checkpoints: [checkpoint(RUN)],
        revertOperations: [],
        runSessionIds: new Map(),
      }),
    ).toThrow(/UNKNOWN_RUN|no owning session/);
  });
});

describe("planCleanupJobs", () => {
  test("produces content-addressed ids so a retried plan reuses the same job", () => {
    const input = {
      checkpoints: [checkpoint(RUN)],
      revertOperations: [],
      runSessionIds: new Map([[RUN, SESSION]]),
      now: NOW,
    };
    const first = planCleanupJobs(input);
    const second = planCleanupJobs({ ...input, now: "2026-07-25T00:00:00.000Z" });

    expect(first).toHaveLength(1);
    expect(first[0]?.id).toBe(second[0]?.id as string);
    expect(first[0]?.status).toBe("pending");
    expect(JSON.parse(first[0]?.session_ids_json as string)).toEqual([SESSION]);
    expect(JSON.parse(first[0]?.refs_json as string)).toEqual([
      runCheckpointRef(SESSION, RUN, "after"),
      runCheckpointRef(SESSION, RUN, "before"),
    ]);
  });

  test("changes the id when the ref set changes", () => {
    const one = planCleanupJobs({
      checkpoints: [checkpoint(RUN)],
      revertOperations: [],
      runSessionIds: new Map([[RUN, SESSION]]),
      now: NOW,
    });
    const two = planCleanupJobs({
      checkpoints: [checkpoint(RUN), checkpoint("crun_a2")],
      revertOperations: [],
      runSessionIds: new Map([
        [RUN, SESSION],
        ["crun_a2", SESSION],
      ]),
      now: NOW,
    });
    expect(one[0]?.id).not.toBe(two[0]?.id as string);
  });
});

const checkpoint = (
  runId: string,
  overrides: Partial<CheckpointRefRow> = {},
): CheckpointRefRow => ({
  runId,
  workspacePath: "/w/a",
  worktreeRoot: "/w/a",
  gitCommonDir: "/repo/.git",
  beforeRef: runCheckpointRef(SESSION, runId, "before"),
  afterRef: runCheckpointRef(SESSION, runId, "after"),
  ...overrides,
});

const revert = (overrides: Partial<RevertRefRow> = {}): RevertRefRow => ({
  id: OPERATION,
  sessionId: SESSION,
  targetRunId: RUN,
  targetCheckpointRef: runCheckpointRef(SESSION, RUN, "before"),
  backupCheckpointRef: revertBackupRef(SESSION, OPERATION),
  refsToDeleteJson: "[]",
  ...overrides,
});
