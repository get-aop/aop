import { join } from "node:path";
import { LIBRARY_DEFAULT_FOLDERS, normalizeLibraryName } from "@aop/common";
import { generateTypeId, getLogger } from "@aop/infra";
import type { Kysely } from "kysely";
import {
  chatSessionAttachmentsDir,
  decodeStoredAttachmentMetadata,
} from "../chat-session/message-images.ts";
import type { ChatMessage, ChatSession, Database } from "../db/schema.ts";
import { createLibraryRepository } from "./repository.ts";
import { sha256Of } from "./store.ts";

const logger = getLogger("library", "chat-index");

const DESCRIPTION_MAX = 280;

/**
 * Puts the images and documents a person sent in a project chat into its Library, where they
 * are: the message keeps its own file, and the Library item points at it. Safe to run again on
 * the same message. Runs inside the message's transaction, so it never takes the Library lock.
 */
export const indexSentAttachments = async (
  db: Kysely<Database>,
  session: Pick<ChatSession, "id" | "project_id">,
  message: Pick<ChatMessage, "id" | "content" | "created_at" | "role">,
  now: Date = new Date(),
): Promise<number> => {
  if (!session.project_id || message.role !== "user") return 0;
  const repository = createLibraryRepository(db);
  let indexed = 0;
  for (const file of sentFiles(message.content, message.created_at)) {
    const path = join(chatSessionAttachmentsDir(session.id), file.fileName);
    const blob = Bun.file(path);
    if (!(await blob.exists())) continue;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const at = now.toISOString();
    const inserted = await repository.insertChatOnce({
      id: generateTypeId("lib"),
      project_id: session.project_id,
      source: "chat",
      name: file.name,
      folder: LIBRARY_DEFAULT_FOLDERS.chat,
      description: file.description,
      mime_type: file.mimeType,
      size: bytes.length,
      sha256: sha256Of(bytes),
      session_id: session.id,
      message_id: message.id,
      attachment_file: file.fileName,
      created_at: message.created_at,
      added_at: at,
      updated_at: at,
      last_accessed_at: at,
    });
    if (inserted) indexed++;
  }
  return indexed;
};

/**
 * Indexes what the person sent before the Library existed, or what a failed index missed.
 * The daily cleanup runs it; a file already indexed, or removed by retention, is skipped.
 */
export const backfillSentAttachments = async (db: Kysely<Database>): Promise<number> => {
  const messages = await db
    .selectFrom("chat_messages")
    .innerJoin("chat_sessions", "chat_sessions.id", "chat_messages.session_id")
    .select([
      "chat_messages.id",
      "chat_messages.content",
      "chat_messages.created_at",
      "chat_messages.role",
      "chat_sessions.id as session_id",
      "chat_sessions.project_id",
    ])
    .where("chat_sessions.project_id", "is not", null)
    .where("chat_messages.role", "=", "user")
    .where("chat_messages.content", "like", "%<!--aop-chat-%")
    .execute();
  const known = new Set(
    (
      await db
        .selectFrom("library_items")
        .select(["session_id", "attachment_file"])
        .where("source", "=", "chat")
        .execute()
    ).map((row) => `${row.session_id}/${row.attachment_file}`),
  );
  let indexed = 0;
  for (const message of messages) {
    const files = sentFiles(message.content, message.created_at);
    if (files.every((file) => known.has(`${message.session_id}/${file.fileName}`))) continue;
    try {
      indexed += await indexSentAttachments(
        db,
        { id: message.session_id, project_id: message.project_id },
        message,
      );
    } catch (error) {
      logger.warn("Indexing the attachments of message {messageId} failed: {error}", {
        messageId: message.id,
        error: String(error),
      });
    }
  }
  return indexed;
};

interface SentFile {
  fileName: string;
  name: string;
  mimeType: string;
  description: string;
}

// An image has no name of its own; it is named for when it was sent, e.g. image-2026-10-02-1430-1.png.
const sentFiles = (content: string, sentAt: string): SentFile[] => {
  const { text, images, documents } = decodeStoredAttachmentMetadata(content);
  const description = text.trim().slice(0, DESCRIPTION_MAX);
  const stamp = sentAt.slice(0, 16).replace("T", "-").replace(":", "");
  return [
    ...images.map((image, index) => ({
      fileName: image.fileName,
      name: `image-${stamp}-${index + 1}.${image.fileName.split(".").pop() ?? "png"}`,
      mimeType: image.mimeType,
      description,
    })),
    ...documents.map((document) => ({
      fileName: document.fileName,
      name: normalizeLibraryName(document.originalFileName) ?? document.fileName,
      mimeType: document.mimeType,
      description,
    })),
  ];
};
