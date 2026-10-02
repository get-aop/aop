import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ArtifactDetail, parseArtifactMarker } from "@aop/common";
import { createLibraryProject, getListing } from "../library/test-utils.ts";
import { createProjectStack, type ProjectStack, useTempAopHome } from "../project/test-utils.ts";

// aop_artifact_create and _update as an agent calls them, through the MCP endpoint: what they
// validate, what they keep, and the marker line the chat's card is made from.

const home = useTempAopHome();
let stack: ProjectStack | undefined;

afterEach(async () => {
  await stack?.cleanup();
  stack = undefined;
});

const setup = async () => {
  const s = await createProjectStack(home.path(), { repos: 0 });
  stack = s;
  const { projectId, coordinator } = await createLibraryProject(s);
  return { s, projectId, coordinator };
};

const textOf = (result: { content: { text: string }[] }) => result.content[0]?.text ?? "";

const getArtifact = async (s: ProjectStack, projectId: string, id: string) => {
  const { status, body } = await s.api<{ artifact: ArtifactDetail }>(
    "GET",
    `/api/projects/${projectId}/artifacts/${id}`,
  );
  if (status !== 200) throw new Error(`artifact read failed: ${status}`);
  return body.artifact;
};

const versionText = async (s: ProjectStack, projectId: string, id: string, version: number) => {
  const response = await s.app.request(
    `/api/projects/${projectId}/artifacts/${id}/versions/${version}/content`,
  );
  return { status: response.status, text: await response.text(), headers: response.headers };
};

describe("aop_artifact_create", () => {
  test("keeps the document in the Library as version 1 and ends its result with the card's marker", async () => {
    const { s, projectId, coordinator } = await setup();

    const result = await s.callTool(coordinator.id, "aop_artifact_create", {
      title: "Release plan",
      content: "# Release\n\n| Step | Who |\n| --- | --- |\n| Tag | CI |",
    });

    expect(result.isError).toBeUndefined();
    const ref = parseArtifactMarker(textOf(result));
    expect(ref).toMatchObject({
      version: 1,
      title: "Release plan",
      kind: "markdown",
      action: "created",
    });
    const artifact = await getArtifact(s, projectId, ref?.artifactId ?? "");
    expect(artifact).toMatchObject({
      title: "Release plan",
      kind: "markdown",
      name: "release-plan.md",
      folder: "Artifacts",
      currentVersion: 1,
      versioned: true,
      originMessageId: null,
    });
    expect(artifact.versions.map((version) => version.version)).toEqual([1]);
    expect((await getListing(s, projectId)).items.map((item) => item.name)).toEqual([
      "release-plan.md",
    ]);
  });

  test("infers the kind from the name, takes code's language, and reads images from the workspace", async () => {
    const { s, projectId, coordinator } = await setup();
    const workspace = coordinator.workspace_path ?? "";
    mkdirSync(join(workspace, "out"), { recursive: true });
    // A 1x1 PNG.
    const png = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      ),
      (char) => char.charCodeAt(0),
    );
    writeFileSync(join(workspace, "out", "chart.png"), png);

    const json = await s.callTool(coordinator.id, "aop_artifact_create", {
      title: "Report",
      content: '{"ok": true}',
      name: "report.json",
    });
    const code = await s.callTool(coordinator.id, "aop_artifact_create", {
      title: "Script",
      content: "print('hi')",
      kind: "code",
      language: "python",
    });
    const image = await s.callTool(coordinator.id, "aop_artifact_create", {
      title: "Chart",
      path: "out/chart.png",
    });

    expect(parseArtifactMarker(textOf(json))?.kind).toBe("json");
    const script = await getArtifact(
      s,
      projectId,
      parseArtifactMarker(textOf(code))?.artifactId ?? "",
    );
    expect(script).toMatchObject({ kind: "code", language: "python", name: "script.py" });
    const chart = parseArtifactMarker(textOf(image));
    expect(chart?.kind).toBe("image");
    const served = await s.app.request(
      `/api/projects/${projectId}/artifacts/${chart?.artifactId}/versions/1/content`,
    );
    expect(served.headers.get("content-type")).toBe("image/png");
  });

  test("refuses content its kind cannot show, a missing title, and both or neither body", async () => {
    const { s, coordinator } = await setup();
    const call = (args: Record<string, unknown>) =>
      s.callTool(coordinator.id, "aop_artifact_create", { title: "X", ...args });

    const json = await call({ content: "{nope", kind: "json" });
    expect(json.isError).toBe(true);
    expect(textOf(json)).toContain("not valid JSON");
    const mermaid = await call({ content: "```mermaid\ngraph TD\n```", kind: "mermaid" });
    expect(textOf(mermaid)).toContain("starts with its diagram type");
    const image = await call({ content: "not a picture", kind: "image" });
    expect(textOf(image)).toContain("PNG, JPEG");
    expect((await call({})).isError).toBe(true);
    expect((await call({ content: "a", path: "b.md" })).isError).toBe(true);
    expect(
      (await s.callTool(coordinator.id, "aop_artifact_create", { title: "", content: "a" }))
        .isError,
    ).toBe(true);
    expect(parseArtifactMarker(textOf(json))).toBeNull();
  });

  test("a thread makes artifacts too", async () => {
    const { s, projectId } = await setup();
    const spawned = await s.services.threads.spawn(projectId, { prompt: "work" });
    if (!spawned.success) throw new Error("thread not spawned");
    await s.settle();

    const result = await s.callTool(spawned.thread.id, "aop_artifact_create", {
      title: "Findings",
      content: "a,b\n1,2",
      kind: "csv",
    });

    expect(parseArtifactMarker(textOf(result))).toMatchObject({ kind: "csv", action: "created" });
  });
});

describe("aop_artifact_update", () => {
  test("adds versions, keeps every earlier one readable, and diffs nothing away", async () => {
    const { s, projectId, coordinator } = await setup();
    const created = parseArtifactMarker(
      textOf(
        await s.callTool(coordinator.id, "aop_artifact_create", {
          title: "Plan",
          content: "# v1",
        }),
      ),
    );
    const id = created?.artifactId ?? "";

    const updated = await s.callTool(coordinator.id, "aop_artifact_update", {
      artifactId: id,
      content: "# v2",
      note: "Second pass",
      title: "Plan, revised",
    });
    await s.callTool(coordinator.id, "aop_artifact_update", { artifactId: id, content: "# v3" });

    expect(parseArtifactMarker(textOf(updated))).toMatchObject({
      artifactId: id,
      version: 2,
      title: "Plan, revised",
      action: "updated",
    });
    const artifact = await getArtifact(s, projectId, id);
    expect(artifact.currentVersion).toBe(3);
    expect(artifact.versions.map(({ version, note }) => ({ version, note }))).toEqual([
      { version: 1, note: null },
      { version: 2, note: "Second pass" },
      { version: 3, note: null },
    ]);
    expect((await versionText(s, projectId, id, 1)).text).toBe("# v1");
    expect((await versionText(s, projectId, id, 2)).text).toBe("# v2");
    // The Library serves the newest version as the item's file.
    const current = await s.app.request(`/api/projects/${projectId}/library/items/${id}/content`);
    expect(await current.text()).toBe("# v3");
    expect((await versionText(s, projectId, id, 4)).status).toBe(404);
  });

  test("turns a plain Library file into an artifact, its file becoming version 1", async () => {
    const { s, projectId, coordinator } = await setup();
    await s.callTool(coordinator.id, "aop_library_save", { content: "a: 1", name: "config.yaml" });
    const [item] = (await getListing(s, projectId)).items;

    const plain = await getArtifact(s, projectId, item?.id ?? "");
    expect(plain).toMatchObject({
      versioned: false,
      kind: "code",
      language: "yaml",
      title: "config.yaml",
    });

    await s.callTool(coordinator.id, "aop_artifact_update", {
      artifactId: item?.id,
      content: "a: 2",
    });

    const promoted = await getArtifact(s, projectId, item?.id ?? "");
    expect(promoted).toMatchObject({ versioned: true, currentVersion: 2 });
    expect((await versionText(s, projectId, item?.id ?? "", 1)).text).toBe("a: 1");
  });

  test("an old version's file survives the Library's cleanup while the artifact lives", async () => {
    const { s, projectId, coordinator } = await setup();
    const ref = parseArtifactMarker(
      textOf(
        await s.callTool(coordinator.id, "aop_artifact_create", { title: "P", content: "one" }),
      ),
    );
    await s.callTool(coordinator.id, "aop_artifact_update", {
      artifactId: ref?.artifactId,
      content: "two",
    });
    const { createLibraryRepository } = await import("../library/repository.ts");
    const { sha256Of } = await import("../library/store.ts");
    const repository = createLibraryRepository(s.db);

    expect(await repository.blobUsers(projectId, sha256Of(new TextEncoder().encode("one")))).toBe(
      1,
    );
    // Both versions count toward the Library's storage.
    expect(await repository.usedBytes(projectId)).toBe(6);
  });

  test("refuses an unknown artifact and invalid content for its kind", async () => {
    const { s, coordinator } = await setup();
    const unknown = await s.callTool(coordinator.id, "aop_artifact_update", {
      artifactId: "lib_nope",
      content: "x",
    });
    expect(textOf(unknown)).toContain("No such artifact");
    const ref = parseArtifactMarker(
      textOf(
        await s.callTool(coordinator.id, "aop_artifact_create", {
          title: "D",
          content: "{}",
          kind: "json",
        }),
      ),
    );
    const bad = await s.callTool(coordinator.id, "aop_artifact_update", {
      artifactId: ref?.artifactId,
      content: "{",
    });
    expect(textOf(bad)).toContain("not valid JSON");
  });
});

describe("artifact content route", () => {
  test("serves HTML and SVG inert, with their real type in a header for the view", async () => {
    const { s, projectId, coordinator } = await setup();
    const ref = parseArtifactMarker(
      textOf(
        await s.callTool(coordinator.id, "aop_artifact_create", {
          title: "Page",
          content: "<script>alert(1)</script>",
          kind: "html",
        }),
      ),
    );

    const { headers, text } = await versionText(s, projectId, ref?.artifactId ?? "", 1);

    expect(text).toBe("<script>alert(1)</script>");
    expect(headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(headers.get("content-security-policy")).toContain("sandbox");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("x-artifact-mime-type")).toBe("text/html");
  });

  test("an artifact of another project is not found", async () => {
    const { s, coordinator } = await setup();
    const ref = parseArtifactMarker(
      textOf(await s.callTool(coordinator.id, "aop_artifact_create", { title: "P", content: "x" })),
    );
    const other = await createLibraryProject(s, "Other");
    const { status } = await s.api(
      "GET",
      `/api/projects/${other.projectId}/artifacts/${ref?.artifactId}`,
    );
    expect(status).toBe(404);
  });
});

describe("workspace files", () => {
  test("a file a reply links is read from its chat's workspace, never outside it, and can be kept", async () => {
    const { s, projectId, coordinator } = await setup();
    const workspace = coordinator.workspace_path ?? "";
    mkdirSync(join(workspace, "docs"), { recursive: true });
    writeFileSync(join(workspace, "docs", "plan.md"), "# Plan");
    const url = (path: string) =>
      `/api/projects/${projectId}/workspace-files?path=${encodeURIComponent(path)}`;

    const read = await s.app.request(url("docs/plan.md"));
    expect(await read.text()).toBe("# Plan");
    expect(read.headers.get("x-artifact-mime-type")).toBe("text/markdown");
    expect((await s.app.request(url("../../etc/passwd"))).status).toBe(400);

    const saved = await s.api<{ artifact: ArtifactDetail }>(
      "POST",
      `/api/projects/${projectId}/workspace-files/save`,
      { path: "docs/plan.md" },
    );
    expect(saved.status).toBe(201);
    expect(saved.body.artifact).toMatchObject({
      title: "plan.md",
      kind: "markdown",
      versioned: true,
    });
  });
});
