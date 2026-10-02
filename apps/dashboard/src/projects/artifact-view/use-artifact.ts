import {
  type ArtifactDetail,
  artifactKindOf,
  codeLanguageOf,
  TEXT_ARTIFACT_KINDS,
} from "@aop/common";
import { useEffect, useMemo, useState } from "react";
import {
  artifactContentPath,
  getArtifact,
  type LoadedFile,
  loadFile,
  workspaceFilePath,
} from "../../api/artifacts";
import type { ArtifactViewRef } from "../../shell/router";
import type { ArtifactContent } from "./renderers/ArtifactBody";

/** What the view shows: the artifact (or file) and the version on screen, with its bytes. */
export interface ShownArtifact {
  detail: ArtifactDetail;
  version: number;
  content: ArtifactContent;
}

export type ArtifactState =
  | { state: "loading" }
  | { state: "failed"; error: string }
  | ({ state: "ready" } & ShownArtifact);

type FileRef = Exclude<ArtifactViewRef, { kind: "visualize" }>;

/**
 * Loads what a view address names. An artifact is read with its versions, then the version
 * asked for (the current one when none is); a version the artifact did not have when it was read
 * (a card for an update just made) reads it again. A version's bytes never change, so each is
 * fetched once.
 */
export const useArtifact = (projectId: string, ref: FileRef): ArtifactState => {
  const [state, setState] = useState<ArtifactState>({ state: "loading" });
  const key = refKey(ref);
  // The same address is the same ref, whichever object holds it.
  const stable = useMemo(() => JSON.parse(key) as FileRef, [key]);
  useEffect(() => {
    let current = true;
    setState((previous) =>
      previous.state === "ready" && sameItem(previous, stable) ? previous : { state: "loading" },
    );
    load(projectId, stable)
      .then((shown) => current && setState({ state: "ready", ...shown }))
      .catch((error: unknown) => {
        if (current)
          setState({
            state: "failed",
            error: error instanceof Error ? error.message : String(error),
          });
      });
    return () => {
      current = false;
    };
  }, [projectId, stable]);
  return state;
};

/** The text of another version of the same artifact, for comparing; null until it is loaded. */
export const useVersionText = (
  projectId: string,
  artifactId: string,
  version: number | null,
): string | null => {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    setText(null);
    if (version === null) return;
    let current = true;
    void loadVersion(projectId, artifactId, version)
      .then((file) => file.blob.text())
      .then((value) => current && setText(value));
    return () => {
      current = false;
    };
  }, [projectId, artifactId, version]);
  return text;
};

export const refKey = (ref: ArtifactViewRef): string => JSON.stringify(ref);

const sameItem = (shown: ShownArtifact, ref: FileRef): boolean =>
  ref.kind === "artifact" && shown.detail.id === ref.id;

const details = new Map<string, ArtifactDetail>();
const versions = new Map<string, Promise<LoadedFile>>();

const load = async (projectId: string, ref: FileRef): Promise<ShownArtifact> => {
  if (ref.kind === "file") return loadWorkspaceFile(projectId, ref.threadId, ref.path);
  let detail = details.get(ref.id);
  if (
    !detail ||
    (ref.version !== undefined && !detail.versions.some((v) => v.version === ref.version))
  ) {
    detail = await getArtifact(projectId, ref.id);
    details.set(ref.id, detail);
  }
  const version = ref.version ?? detail.currentVersion;
  const shown = detail.versions.find((candidate) => candidate.version === version);
  if (!shown) throw new Error(`Version ${version} of this artifact is not in the Library`);
  const file = await loadVersion(projectId, detail.id, version);
  return {
    detail,
    version,
    content: await contentOf(file, shown.kind, detail.language, detail.title),
  };
};

/** Forgets what was read about an artifact, so the view reads it again (after a Visualize save). */
export const forgetArtifact = (artifactId: string): void => {
  details.delete(artifactId);
};

const loadVersion = (
  projectId: string,
  artifactId: string,
  version: number,
): Promise<LoadedFile> => {
  const key = `${projectId}/${artifactId}/${version}`;
  const cached = versions.get(key);
  if (cached) return cached;
  const loading = loadFile(artifactContentPath(projectId, artifactId, version));
  versions.set(key, loading);
  loading.catch(() => versions.delete(key));
  return loading;
};

const loadWorkspaceFile = async (
  projectId: string,
  threadId: string | null,
  path: string,
): Promise<ShownArtifact> => {
  const file = await loadFile(workspaceFilePath(projectId, threadId, path));
  const name = path.split("/").filter(Boolean).pop() ?? path;
  const kind = artifactKindOf(name, file.mimeType);
  const detail: ArtifactDetail = {
    id: `file:${path}`,
    title: name,
    kind,
    language: kind === "code" ? codeLanguageOf(name) : null,
    name,
    folder: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "",
    currentVersion: 1,
    versions: [
      {
        version: 1,
        size: file.blob.size,
        mimeType: file.mimeType,
        kind,
        note: null,
        createdAt: "",
        messageId: null,
      },
    ],
    versioned: false,
    originMessageId: null,
    originType: null,
    expiresAt: null,
  };
  return { detail, version: 1, content: await contentOf(file, kind, detail.language, name) };
};

const contentOf = async (
  file: LoadedFile,
  kind: ArtifactContent["kind"],
  language: string | null,
  title: string,
): Promise<ArtifactContent> => ({
  kind,
  blob: file.blob,
  mimeType: file.mimeType,
  text: TEXT_ARTIFACT_KINDS.has(kind) ? await file.blob.text() : null,
  language,
  title,
});
