import type {
  ArtifactDetail,
  VisualizeCandidate,
  VisualizeGenerateInput,
  VisualizeRepairInput,
  VisualizeSaveInput,
} from "@aop/common";
import { apiUrl, authHeaders, isRemoteHost } from "./host";
import { ApiError, request } from "./request";

const projectPath = (projectId: string): string => `/projects/${encodeURIComponent(projectId)}`;

export const getArtifact = async (projectId: string, artifactId: string): Promise<ArtifactDetail> =>
  (
    await request<{ artifact: ArtifactDetail }>(
      `${projectPath(projectId)}/artifacts/${encodeURIComponent(artifactId)}`,
    )
  ).artifact;

/** A file's bytes and the type it really is: the host sends HTML and SVG as inert text. */
export interface LoadedFile {
  blob: Blob;
  mimeType: string;
}

export const artifactContentPath = (projectId: string, artifactId: string, version: number) =>
  `${projectPath(projectId)}/artifacts/${encodeURIComponent(artifactId)}/versions/${version}/content`;

export const workspaceFilePath = (projectId: string, threadId: string | null, path: string) =>
  `${projectPath(projectId)}/workspace-files?path=${encodeURIComponent(path)}${
    threadId ? `&threadId=${encodeURIComponent(threadId)}` : ""
  }`;

/** Fetched like any API call, so the bearer token a desktop or remote host needs goes with it. */
export const loadFile = async (path: string): Promise<LoadedFile> => {
  const response = await fetch(apiUrl(path), {
    cache: "no-store",
    credentials: isRemoteHost() ? "include" : "same-origin",
    headers: authHeaders(),
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new ApiError(
      response.status,
      data.code ?? "UNKNOWN",
      data.error ?? `Request failed (${response.status})`,
    );
  }
  const blob = await response.blob();
  return { blob, mimeType: response.headers.get("X-Artifact-Mime-Type") ?? blob.type };
};

export const saveWorkspaceFile = async (
  projectId: string,
  threadId: string | null,
  path: string,
): Promise<ArtifactDetail> =>
  (
    await request<{ artifact: ArtifactDetail }>(`${projectPath(projectId)}/workspace-files/save`, {
      method: "POST",
      body: JSON.stringify({ threadId, path }),
    })
  ).artifact;

export interface VisualizeDrawn {
  candidate: VisualizeCandidate;
  durationMs: number;
  costUsd: number | null;
}

export const getVisualized = async (
  projectId: string,
  messageId: string,
): Promise<ArtifactDetail | null> =>
  (
    await request<{ artifact: ArtifactDetail | null }>(
      `${projectPath(projectId)}/visualize/${encodeURIComponent(messageId)}`,
    )
  ).artifact;

export const generateVisualization = (
  projectId: string,
  input: VisualizeGenerateInput,
): Promise<VisualizeDrawn> =>
  request(`${projectPath(projectId)}/visualize/generate`, {
    method: "POST",
    body: JSON.stringify(input),
  });

export const repairVisualization = (
  projectId: string,
  input: VisualizeRepairInput,
): Promise<VisualizeDrawn> =>
  request(`${projectPath(projectId)}/visualize/repair`, {
    method: "POST",
    body: JSON.stringify(input),
  });

export const saveVisualization = async (
  projectId: string,
  input: VisualizeSaveInput,
): Promise<ArtifactDetail> =>
  (
    await request<{ artifact: ArtifactDetail }>(`${projectPath(projectId)}/visualize/save`, {
      method: "POST",
      body: JSON.stringify(input),
    })
  ).artifact;
