import { describe, expect, test } from "bun:test";
import { type ArtifactViewRef, type ProjectScreen, parseRoute, projectScreenPath } from "./router";

const roundTrip = (screen: ProjectScreen) => parseRoute(projectScreenPath(screen));

describe("artifact view addresses", () => {
  const refs: ArtifactViewRef[] = [
    { kind: "artifact", id: "lib_1" },
    { kind: "artifact", id: "lib_1", version: 3 },
    { kind: "file", threadId: null, path: "docs/plan.md" },
    { kind: "file", threadId: "isess_1", path: "/abs/path with space/a.json" },
    { kind: "visualize", messageId: "smsg_1" },
  ];

  test("every view over the project screen and a thread's reads back as itself", () => {
    for (const artifact of refs) {
      expect(roundTrip({ name: "project", projectId: "p1", artifact })).toEqual({
        name: "project",
        projectId: "p1",
        artifact,
      });
      expect(roundTrip({ name: "thread", projectId: "p1", threadId: "t1", artifact })).toEqual({
        name: "thread",
        projectId: "p1",
        threadId: "t1",
        artifact,
      });
    }
  });

  test("addresses as written", () => {
    expect(
      projectScreenPath({ name: "project", projectId: "p1", artifact: refs[1] as ArtifactViewRef }),
    ).toBe("/projects/p1/artifacts/lib_1/3");
    expect(
      projectScreenPath({ name: "project", projectId: "p1", artifact: refs[2] as ArtifactViewRef }),
    ).toBe("/projects/p1/files/coordinator/docs%2Fplan.md");
    expect(
      projectScreenPath({
        name: "thread",
        projectId: "p1",
        threadId: "t1",
        artifact: refs[4] as ArtifactViewRef,
      }),
    ).toBe("/projects/p1/threads/t1/visualize/smsg_1");
  });

  test("a pull request wins over an artifact: one view at a time", () => {
    expect(
      projectScreenPath({
        name: "project",
        projectId: "p1",
        pullRequest: { repoId: "r", number: 4 },
        artifact: { kind: "artifact", id: "lib_1" },
      }),
    ).toBe("/projects/p1/pulls/r/4");
  });

  test("refuses malformed views", () => {
    for (const path of [
      "/projects/p1/artifacts",
      "/projects/p1/artifacts/lib_1/0",
      "/projects/p1/artifacts/lib_1/v2",
      "/projects/p1/artifacts/lib_1/2/extra",
      "/projects/p1/files/coordinator",
      "/projects/p1/visualize/m1/extra",
      "/projects/p1/settings/artifacts/lib_1",
    ]) {
      expect(parseRoute(path)).toBeNull();
    }
  });
});
