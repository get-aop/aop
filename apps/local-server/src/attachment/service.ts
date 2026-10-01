import { join } from "node:path";
import {
  CHAT_IMAGE_LIMITS,
  type ChatImageAttachment,
  type ChatImageMimeType,
  type UploadedChatImage,
} from "@aop/common";
import { generateTypeId } from "@aop/infra";
import { chatSessionAttachmentsDir } from "../chat-session/message-images.ts";
import type { LocalServerContext } from "../context.ts";
import { sniffImageType } from "./image-type.ts";
import { findStaged, pruneStaleUploads, removeStaged, stageUpload } from "./staging.ts";

export type AttachmentError =
  | { code: "PROJECT_NOT_FOUND" }
  | { code: "EMPTY_IMAGE" }
  | { code: "UNSUPPORTED_IMAGE" }
  | { code: "IMAGE_TOO_LARGE"; maxBytes: number }
  | { code: "IMAGE_NOT_FOUND" };

export type AttachmentResult<T> =
  | ({ success: true } & T)
  | { success: false; error: AttachmentError };

export interface AttachmentService {
  /** Keeps an image for a message the person is writing in one of the project's chats. */
  upload: (
    projectId: string,
    bytes: Uint8Array,
  ) => Promise<AttachmentResult<{ image: UploadedChatImage }>>;
  /** The file of an image sent in one of the project's chats, by the name its message gives it. */
  messageImage: (
    projectId: string,
    fileName: string,
  ) => Promise<AttachmentResult<{ path: string; mimeType: ChatImageMimeType }>>;
}

export const createAttachmentService = (ctx: LocalServerContext): AttachmentService => ({
  upload: async (projectId, bytes) => {
    if (!(await ctx.projectRepository.getById(projectId)))
      return fail({ code: "PROJECT_NOT_FOUND" });
    const invalid = invalidImage(bytes);
    if (invalid) return fail(invalid);
    const mimeType = sniffImageType(bytes) as ChatImageMimeType;
    const id = generateTypeId("img");
    await pruneStaleUploads(projectId);
    await stageUpload(projectId, id, mimeType, bytes);
    return { success: true, image: { id, mimeType, size: bytes.length } };
  },

  messageImage: async (projectId, fileName) => {
    const found = await findMessageImage(ctx, projectId, fileName);
    return found ? { success: true, ...found } : fail({ code: "IMAGE_NOT_FOUND" });
  },
});

// Found only through a message of one of the project's conversations, so a name cannot reach
// another project's images, or any other file.
const findMessageImage = async (
  ctx: LocalServerContext,
  projectId: string,
  fileName: string,
): Promise<{ path: string; mimeType: ChatImageMimeType } | null> => {
  const [, messageId, extension] = MESSAGE_IMAGE.exec(fileName) ?? [];
  const mimeType = MIME_BY_EXTENSION[extension ?? ""];
  if (!messageId || !mimeType) return null;
  const message = await ctx.chatSessionRepository.getMessage(messageId);
  const session = message && (await ctx.chatSessionRepository.getById(message.session_id));
  if (!session || session.project_id !== projectId) return null;
  const path = join(chatSessionAttachmentsDir(session.id), fileName);
  return (await Bun.file(path).exists()) ? { path, mimeType } : null;
};

/**
 * The uploads a message names, in order, as the chat engine takes images. An id that is not a
 * waiting upload of this project (never made, already sent, or pruned) refuses the message, so
 * the person is not left believing the model saw an image it did not.
 */
export const readStagedImages = async (
  projectId: string,
  ids: readonly string[],
): Promise<{ images: ChatImageAttachment[] } | { error: string }> => {
  const unique = [...new Set(ids)];
  if (unique.length > CHAT_IMAGE_LIMITS.maxCount) {
    return { error: `Attach at most ${CHAT_IMAGE_LIMITS.maxCount} images to a message` };
  }
  const images: ChatImageAttachment[] = [];
  for (const id of unique) {
    const staged = await findStaged(projectId, id);
    if (!staged) return { error: "An attached image is no longer on the host; attach it again" };
    const data = Buffer.from(await Bun.file(staged.path).arrayBuffer());
    images.push({ id, mimeType: staged.mimeType, dataBase64: data.toString("base64") });
  }
  return { images };
};

/** Forgets the uploads a sent message carried: the conversation holds its own copy now. */
export const discardStagedImages = (projectId: string, ids: readonly string[]): Promise<void> =>
  removeStaged(projectId, ids);

/** Where a sent image is served from, under `/api`: the path the wire message carries. */
export const messageImagePath = (projectId: string, fileName: string): string =>
  `/projects/${encodeURIComponent(projectId)}/images/${encodeURIComponent(fileName)}`;

// What `materializeChatImages` names a message's images: `<message id>-<position>.<extension>`.
const MESSAGE_IMAGE = /^(smsg_[0-9a-z]{26})-\d{1,2}\.(png|jpg|webp|gif)$/;

const MIME_BY_EXTENSION: Record<string, ChatImageMimeType> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

const invalidImage = (bytes: Uint8Array): AttachmentError | null => {
  if (bytes.length === 0) return { code: "EMPTY_IMAGE" };
  if (bytes.length > CHAT_IMAGE_LIMITS.maxBytes) {
    return { code: "IMAGE_TOO_LARGE", maxBytes: CHAT_IMAGE_LIMITS.maxBytes };
  }
  return sniffImageType(bytes) ? null : { code: "UNSUPPORTED_IMAGE" };
};

const fail = (error: AttachmentError): { success: false; error: AttachmentError } => ({
  success: false,
  error,
});
