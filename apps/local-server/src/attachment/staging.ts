import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ChatImageMimeType } from "@aop/common";
import { aopPaths } from "@aop/infra";

/**
 * Images uploaded to a project wait here until a message names them. Sending one copies it into
 * its conversation's attachments and removes it from here; one never sent is pruned after a day.
 * The directory goes with the project.
 */
export const uploadsDir = (projectId: string): string =>
  join(aopPaths.projectDir(projectId), "uploads");

export const STALE_UPLOAD_MS = 24 * 60 * 60 * 1000;

const EXTENSIONS: Record<ChatImageMimeType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

// The id is the only part of a path a client chooses, so it must be one the host could have made.
const UPLOAD_ID = /^img_[0-9a-z]{26}$/;

export const isUploadId = (id: string): boolean => UPLOAD_ID.test(id);

export interface StagedUpload {
  path: string;
  mimeType: ChatImageMimeType;
}

export const stageUpload = async (
  projectId: string,
  id: string,
  mimeType: ChatImageMimeType,
  bytes: Uint8Array,
): Promise<void> => {
  const dir = uploadsDir(projectId);
  await mkdir(dir, { recursive: true });
  await Bun.write(join(dir, `${id}.${EXTENSIONS[mimeType]}`), bytes);
};

export const findStaged = async (projectId: string, id: string): Promise<StagedUpload | null> => {
  if (!isUploadId(id)) return null;
  for (const [mimeType, extension] of Object.entries(EXTENSIONS)) {
    const path = join(uploadsDir(projectId), `${id}.${extension}`);
    if (await Bun.file(path).exists()) return { path, mimeType: mimeType as ChatImageMimeType };
  }
  return null;
};

export const removeStaged = async (projectId: string, ids: readonly string[]): Promise<void> => {
  for (const id of ids) {
    const staged = await findStaged(projectId, id);
    if (staged) await rm(staged.path, { force: true });
  }
};

/** Removes the uploads older than `STALE_UPLOAD_MS`: images attached to a message never sent. */
export const pruneStaleUploads = async (projectId: string, now = Date.now()): Promise<void> => {
  const dir = uploadsDir(projectId);
  const names = await readdir(dir).catch(() => [] as string[]);
  for (const name of names) {
    const path = join(dir, name);
    const info = await stat(path).catch(() => null);
    if (info && now - info.mtimeMs > STALE_UPLOAD_MS) await rm(path, { force: true });
  }
};
