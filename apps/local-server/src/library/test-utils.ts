import type { LibraryItem, LibraryListing } from "@aop/common";
import type { ChatSession } from "../db/schema.ts";
import { type ProjectStack, projectSettings } from "../project/test-utils.ts";

/** A project with its coordinator on a stack the test made. */
export const createLibraryProject = async (
  s: ProjectStack,
  name = "Checkout revamp",
): Promise<{ projectId: string; coordinator: ChatSession }> => {
  const created = await s.services.projects.create(
    projectSettings({ name, repoIds: s.repos.map((repo) => repo.id) }),
  );
  if (!created.success) throw new Error("project not created");
  const coordinator = await s.ctx.chatSessionRepository.getCoordinator(created.project.id);
  if (!coordinator) throw new Error("project has no coordinator");
  return { projectId: created.project.id, coordinator };
};

/** POSTs a file the way the dashboard's "+ Add" does. */
export const uploadRaw = async (
  s: ProjectStack,
  projectId: string,
  name: string,
  bytes: Uint8Array | string,
  folder?: string,
): Promise<{ status: number; body: Record<string, unknown> }> => {
  const query = folder === undefined ? "" : `?folder=${encodeURIComponent(folder)}`;
  const response = await s.app.request(`/api/projects/${projectId}/library${query}`, {
    method: "POST",
    headers: { "X-File-Name": encodeURIComponent(name) },
    body: typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes,
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

/** Uploads a file and returns its item; a refusal fails the test. */
export const uploadFile = async (
  s: ProjectStack,
  projectId: string,
  name: string,
  bytes: Uint8Array | string,
  folder?: string,
): Promise<LibraryItem> => {
  const { status, body } = await uploadRaw(s, projectId, name, bytes, folder);
  if (status !== 201) throw new Error(`upload refused: ${status} ${JSON.stringify(body)}`);
  return body.item as LibraryItem;
};

export const getListing = async (s: ProjectStack, projectId: string): Promise<LibraryListing> => {
  const { status, body } = await s.api<LibraryListing>("GET", `/api/projects/${projectId}/library`);
  if (status !== 200) throw new Error(`listing failed: ${status}`);
  return body;
};

/** Bytes of a given size, all one value: distinct values make distinct content. */
export const filler = (size: number, value = 7): Uint8Array => new Uint8Array(size).fill(value);
