import { rm } from "node:fs/promises";
import { join } from "node:path";
import { chatSessionAttachmentsDir } from "../chat-session/message-images.ts";
import type { LibraryItemRow, LibraryRemovedReason } from "../db/library-schema.ts";
import type { LibraryRepository } from "./repository.ts";
import { removeBlob } from "./store.ts";

/**
 * Takes an item out of the Library and frees its file. A chat attachment's file is its
 * message's, so the row stays behind as a marker and the message shows the file as expired or
 * deleted instead of a broken image. Any other item goes, and its blob with it once no other
 * item shares the content. Call it under the project's Library lock.
 */
export const removeLibraryItem = async (
  repository: LibraryRepository,
  row: LibraryItemRow,
  reason: LibraryRemovedReason,
  now: Date,
): Promise<void> => {
  if (row.source === "chat") {
    if (row.session_id && row.attachment_file) {
      await rm(join(chatSessionAttachmentsDir(row.session_id), row.attachment_file), {
        force: true,
      });
    }
    await repository.markRemoved(row.id, reason, now.toISOString());
    return;
  }
  await repository.delete(row.id);
  if ((await repository.blobUsers(row.project_id, row.sha256)) === 0) {
    await removeBlob(row.project_id, row.sha256);
  }
};
