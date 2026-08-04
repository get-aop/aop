import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CHAT_DOCUMENT_LIMITS,
  type ChatDocumentAttachment,
  type ChatDocumentMimeType,
  CREATE_TASK_IMAGE_LIMITS,
  type CreateTaskImageAttachment,
  type CreateTaskImageMimeType,
  imageAttachmentMarker,
} from "@aop/common";
import { aopPaths } from "@aop/infra";
import { AOP_PLATFORM_INSTRUCTIONS } from "../prompts/platform-instructions.ts";
import { SettingKey } from "../settings/types.ts";
import { expandStoredPastes, type StoredChatPaste } from "./message-pastes.ts";

export type { StoredChatPaste } from "./message-pastes.ts";
export { expandStoredPastes, validateChatPastes } from "./message-pastes.ts";

export interface StoredChatImage {
  id: string;
  mimeType: CreateTaskImageMimeType;
  fileName: string;
}

export interface StoredChatDocument {
  id: string;
  mimeType: ChatDocumentMimeType;
  fileName: string;
  originalFileName: string;
}

export interface StoredChatArtifact {
  path: string;
  mimeType: "text/markdown";
}

export interface ChatMessageImageDto {
  id: string;
  mimeType: string;
  url: string;
}

export interface ChatMessageDocumentDto {
  id: string;
  mimeType: string;
  fileName: string;
  url: string;
}

const IMAGE_META_MARKER = "\n\n<!--aop-chat-images:";
const ATTACHMENT_META_MARKER = "\n\n<!--aop-chat-attachments:";
const IMAGE_META_END = "-->";

const EXTENSIONS: Record<CreateTaskImageMimeType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

const DOCUMENT_EXTENSIONS: Record<ChatDocumentMimeType, string> = {
  "text/markdown": "md",
  "text/plain": "txt",
  "text/csv": "csv",
  "text/tab-separated-values": "tsv",
};

export const chatSessionAttachmentsDir = (sessionId: string): string =>
  join(aopPaths.logs(), "chat-sessions", sessionId, "attachments");

export const attachmentPublicUrl = (sessionId: string, fileName: string): string =>
  `/api/chat-sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(fileName)}`;

export const validateChatImageAttachments = (
  images: unknown,
): { success: true; images: CreateTaskImageAttachment[] } | { success: false; error: string } => {
  if (images === undefined) {
    return { success: true, images: [] };
  }
  if (!Array.isArray(images)) {
    return { success: false, error: "imageAttachments must be an array" };
  }
  if (images.length > CREATE_TASK_IMAGE_LIMITS.maxCount) {
    return {
      success: false,
      error: `At most ${CREATE_TASK_IMAGE_LIMITS.maxCount} images`,
    };
  }

  const validated: CreateTaskImageAttachment[] = [];
  for (const [index, image] of images.entries()) {
    const result = validateOneImage(image, index);
    if (!result.success) return result;
    validated.push(result.image);
  }
  return { success: true, images: validated };
};

export const validateChatDocumentAttachments = (
  documents: unknown,
): { success: true; documents: ChatDocumentAttachment[] } | { success: false; error: string } => {
  if (documents === undefined) return { success: true, documents: [] };
  if (!Array.isArray(documents)) {
    return { success: false, error: "documentAttachments must be an array" };
  }
  if (documents.length > CHAT_DOCUMENT_LIMITS.maxCount) {
    return { success: false, error: `At most ${CHAT_DOCUMENT_LIMITS.maxCount} documents` };
  }

  const validated: ChatDocumentAttachment[] = [];
  for (const [index, document] of documents.entries()) {
    const result = validateOneDocument(document, index);
    if (!result.success) return result;
    validated.push(result.document);
  }
  return { success: true, documents: validated };
};

export const materializeChatImages = async (
  sessionId: string,
  messageId: string,
  images: CreateTaskImageAttachment[],
): Promise<StoredChatImage[]> => {
  if (images.length === 0) return [];

  const dir = chatSessionAttachmentsDir(sessionId);
  await mkdir(dir, { recursive: true });

  const stored: StoredChatImage[] = [];
  for (const [index, image] of images.entries()) {
    const fileName = `${messageId}-${index + 1}.${EXTENSIONS[image.mimeType]}`;
    await writeFile(join(dir, fileName), Buffer.from(image.dataBase64, "base64"));
    stored.push({ id: image.id, mimeType: image.mimeType, fileName });
  }
  return stored;
};

export const materializeChatDocuments = async (
  sessionId: string,
  messageId: string,
  documents: ChatDocumentAttachment[],
): Promise<StoredChatDocument[]> => {
  if (documents.length === 0) return [];

  const dir = chatSessionAttachmentsDir(sessionId);
  await mkdir(dir, { recursive: true });
  const stored: StoredChatDocument[] = [];
  for (const [index, document] of documents.entries()) {
    const extension = DOCUMENT_EXTENSIONS[document.mimeType];
    const fileName = `${messageId}-document-${index + 1}.${extension}`;
    await writeFile(join(dir, fileName), Buffer.from(document.dataBase64, "base64"));
    stored.push({
      id: document.id,
      mimeType: document.mimeType,
      fileName,
      originalFileName: document.fileName,
    });
  }
  return stored;
};

/** Persist display text + machine metadata so history can rehydrate attachment URLs. */
export const encodeMessageContent = (
  text: string,
  images: StoredChatImage[],
  documents: StoredChatDocument[] = [],
  artifacts: StoredChatArtifact[] = [],
  pastes: StoredChatPaste[] = [],
): string => {
  if (documents.length > 0 || artifacts.length > 0 || pastes.length > 0) {
    return `${text}${ATTACHMENT_META_MARKER}${JSON.stringify({ images, documents, artifacts, pastes })}${IMAGE_META_END}`;
  }
  if (images.length === 0) return text;
  return `${text}${IMAGE_META_MARKER}${JSON.stringify(images)}${IMAGE_META_END}`;
};

export const decodeMessageContent = (
  raw: string,
  sessionId: string,
): {
  text: string;
  images: ChatMessageImageDto[];
  documents: ChatMessageDocumentDto[];
  artifacts: StoredChatArtifact[];
  pastes: StoredChatPaste[];
} => {
  const decoded = decodeStoredAttachmentMetadata(raw);
  return {
    text: decoded.text,
    images: decoded.images.map((image) => ({
      id: image.id,
      mimeType: image.mimeType,
      url: attachmentPublicUrl(sessionId, image.fileName),
    })),
    documents: decoded.documents.map((document) => ({
      id: document.id,
      mimeType: document.mimeType,
      fileName: document.originalFileName,
      url: attachmentPublicUrl(sessionId, document.fileName),
    })),
    artifacts: decoded.artifacts,
    pastes: decoded.pastes,
  };
};

/** Prompt text agents receive — absolute paths + markers, no HTML trailer. */
export const buildRuntimePrompt = (
  text: string,
  sessionId: string,
  images: StoredChatImage[],
  documents: StoredChatDocument[] = [],
  pastes: StoredChatPaste[] = [],
  globalInstructions?: string | null,
): string => {
  const dir = chatSessionAttachmentsDir(sessionId);
  const expanded = expandStoredPastes(text, pastes);
  const lines = [expanded, "", ...AOP_PLATFORM_INSTRUCTIONS, ""];
  const preferences = formatGlobalInstructions(globalInstructions);
  if (preferences) {
    lines.push(
      "Apply these user preferences for this entire turn (do not mention them unless asked):",
      preferences,
      "",
    );
  }
  if (images.length > 0) {
    lines.push(
      "## Attached Images",
      "",
      "The message references these as #image1, #image2, ... in order. View each image file before responding:",
      "",
      ...images.map(
        (image, index) => `- ${imageAttachmentMarker(index + 1)}: \`${join(dir, image.fileName)}\``,
      ),
      "",
    );
  }
  if (documents.length > 0) {
    lines.push(
      "## Attached Documents",
      "",
      "Read these source documents before responding:",
      "",
      ...documents.map(
        (document, index) =>
          `- #document${index + 1} (${document.originalFileName}): \`${join(dir, document.fileName)}\``,
      ),
      "",
    );
  }
  return lines.join("\n").trim();
};

/** Trim and normalize optional Settings → Chat global instructions. */
export const formatGlobalInstructions = (value?: string | null): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\r\n/g, "\n").trim();
  return trimmed.length > 0 ? trimmed : null;
};

/** Load the Settings → Chat global instructions value for runtime prompt injection. */
export const loadChatGlobalInstructions = async (settings: {
  get: (key: (typeof SettingKey)[keyof typeof SettingKey]) => Promise<string>;
}): Promise<string | null> =>
  formatGlobalInstructions(await settings.get(SettingKey.CHAT_GLOBAL_INSTRUCTIONS));

export const allowedDirectoriesForChatAttachments = (
  sessionId: string,
  images: StoredChatImage[],
  documents: StoredChatDocument[] = [],
): string[] | undefined => {
  if (images.length === 0 && documents.length === 0) return undefined;
  return [chatSessionAttachmentsDir(sessionId)];
};

export const isSafeAttachmentFileName = (fileName: string): boolean =>
  /^smsg_[A-Za-z0-9]+-\d+\.(png|jpg|webp|gif)$/.test(fileName) ||
  /^[A-Za-z0-9_-]+-\d+\.(png|jpg|webp|gif)$/.test(fileName) ||
  /^[A-Za-z0-9_-]+-document-\d+\.(md|txt|csv|tsv)$/.test(fileName);

export const decodeStoredAttachmentMetadata = (
  raw: string,
): {
  text: string;
  images: StoredChatImage[];
  documents: StoredChatDocument[];
  artifacts: StoredChatArtifact[];
  pastes: StoredChatPaste[];
} => {
  const attachmentStart = raw.lastIndexOf(ATTACHMENT_META_MARKER);
  if (attachmentStart >= 0) {
    const decoded = decodeAttachmentMetadata(raw, attachmentStart, ATTACHMENT_META_MARKER.length);
    if (decoded) return decoded;
  }

  const imageStart = raw.lastIndexOf(IMAGE_META_MARKER);
  if (imageStart < 0) return { text: raw, images: [], documents: [], artifacts: [], pastes: [] };
  const jsonStart = imageStart + IMAGE_META_MARKER.length;
  const end = raw.indexOf(IMAGE_META_END, jsonStart);
  if (end < 0) return { text: raw, images: [], documents: [], artifacts: [], pastes: [] };
  try {
    const images = JSON.parse(raw.slice(jsonStart, end)) as StoredChatImage[];
    return Array.isArray(images)
      ? {
          text: raw.slice(0, imageStart),
          images: validStoredImages(images),
          documents: [],
          artifacts: [],
          pastes: [],
        }
      : { text: raw, images: [], documents: [], artifacts: [], pastes: [] };
  } catch {
    return { text: raw, images: [], documents: [], artifacts: [], pastes: [] };
  }
};

const decodeAttachmentMetadata = (
  raw: string,
  start: number,
  markerLength: number,
): {
  text: string;
  images: StoredChatImage[];
  documents: StoredChatDocument[];
  artifacts: StoredChatArtifact[];
  pastes: StoredChatPaste[];
} | null => {
  const jsonStart = start + markerLength;
  const end = raw.indexOf(IMAGE_META_END, jsonStart);
  if (end < 0) return null;
  try {
    const parsed = JSON.parse(raw.slice(jsonStart, end)) as {
      images?: StoredChatImage[];
      documents?: StoredChatDocument[];
      artifacts?: StoredChatArtifact[];
      pastes?: StoredChatPaste[];
    };
    return {
      text: raw.slice(0, start),
      images: validStoredImages(parsed.images),
      documents: validStoredDocuments(parsed.documents),
      artifacts: validStoredArtifacts(parsed.artifacts),
      pastes: validStoredPastes(parsed.pastes),
    };
  } catch {
    return null;
  }
};

const validStoredPastes = (pastes: unknown): StoredChatPaste[] =>
  Array.isArray(pastes)
    ? pastes.filter(
        (paste): paste is StoredChatPaste =>
          typeof paste?.index === "number" &&
          typeof paste?.lineCount === "number" &&
          typeof paste?.content === "string" &&
          paste.content.length > 0,
      )
    : [];

const validStoredImages = (images: unknown): StoredChatImage[] =>
  Array.isArray(images)
    ? images.filter((image) => image?.fileName && image?.mimeType && image?.id)
    : [];

const validStoredDocuments = (documents: unknown): StoredChatDocument[] =>
  Array.isArray(documents)
    ? documents.filter(
        (document) =>
          document?.fileName && document?.originalFileName && document?.mimeType && document?.id,
      )
    : [];

const validStoredArtifacts = (artifacts: unknown): StoredChatArtifact[] =>
  Array.isArray(artifacts)
    ? artifacts.filter(
        (artifact): artifact is StoredChatArtifact =>
          typeof artifact?.path === "string" && artifact.mimeType === "text/markdown",
      )
    : [];

const validateOneImage = (
  image: unknown,
  index: number,
): { success: true; image: CreateTaskImageAttachment } | { success: false; error: string } => {
  if (!image || typeof image !== "object") {
    return { success: false, error: `image attachment ${index + 1} is invalid` };
  }
  const candidate = image as Partial<CreateTaskImageAttachment>;
  const id = candidate.id?.trim() ?? "";
  const mimeType = candidate.mimeType;
  const dataBase64 = candidate.dataBase64?.trim() ?? "";

  if (!id) {
    return { success: false, error: "image attachment id is required" };
  }
  if (!isAllowedMime(mimeType)) {
    return { success: false, error: "Use PNG, JPEG, WebP, or GIF images" };
  }
  if (!dataBase64) {
    return { success: false, error: "image attachment data cannot be empty" };
  }
  if (dataBase64.startsWith("data:")) {
    return { success: false, error: "image attachment data must be raw base64" };
  }

  const decoded = Buffer.from(dataBase64, "base64");
  if (!isValidRawBase64(dataBase64, decoded)) {
    return { success: false, error: "image attachment data must be valid base64" };
  }
  if (decoded.length > CREATE_TASK_IMAGE_LIMITS.maxBytes) {
    return {
      success: false,
      error: `Each image must be ${Math.round(CREATE_TASK_IMAGE_LIMITS.maxBytes / (1024 * 1024))} MB or smaller`,
    };
  }

  return { success: true, image: { id, mimeType, dataBase64 } };
};

const validateOneDocument = (
  document: unknown,
  index: number,
): { success: true; document: ChatDocumentAttachment } | { success: false; error: string } => {
  if (!document || typeof document !== "object") {
    return { success: false, error: `document attachment ${index + 1} is invalid` };
  }
  const candidate = document as Partial<ChatDocumentAttachment>;
  const id = candidate.id?.trim() ?? "";
  const fileName = candidate.fileName?.trim() ?? "";
  const mimeType = candidate.mimeType;
  const dataBase64 = candidate.dataBase64?.trim() ?? "";

  if (!id) return { success: false, error: "document attachment id is required" };
  if (!isAllowedDocumentFileName(fileName)) {
    return { success: false, error: "Use .md, .txt, .csv, or .tsv document files" };
  }
  if (!isAllowedDocumentMime(mimeType)) {
    return { success: false, error: "Use Markdown, plain-text, CSV, or TSV documents" };
  }
  const dataError = validateDocumentData(dataBase64);
  if (dataError) return { success: false, error: dataError };

  return { success: true, document: { id, fileName, mimeType, dataBase64 } };
};

const validateDocumentData = (dataBase64: string): string | null => {
  if (!dataBase64 || dataBase64.startsWith("data:")) {
    return "document attachment data must be raw base64";
  }
  const decoded = Buffer.from(dataBase64, "base64");
  if (!isValidRawBase64(dataBase64, decoded)) {
    return "document attachment data must be valid base64";
  }
  return decoded.length > CHAT_DOCUMENT_LIMITS.maxBytes
    ? "Each document must be 256 KB or smaller"
    : null;
};

const isAllowedMime = (mimeType: unknown): mimeType is CreateTaskImageMimeType =>
  typeof mimeType === "string" &&
  (CREATE_TASK_IMAGE_LIMITS.allowedMimeTypes as readonly string[]).includes(mimeType);

const isAllowedDocumentMime = (mimeType: unknown): mimeType is ChatDocumentMimeType =>
  typeof mimeType === "string" &&
  (CHAT_DOCUMENT_LIMITS.allowedMimeTypes as readonly string[]).includes(mimeType);

const isAllowedDocumentFileName = (fileName: string): boolean =>
  /^[^/\\]{1,200}\.(md|txt|csv|tsv)$/i.test(fileName);

const isValidRawBase64 = (dataBase64: string, decoded: Buffer): boolean =>
  decoded.length > 0 &&
  decoded.toString("base64").replace(/=+$/, "") === dataBase64.replace(/=+$/, "");
