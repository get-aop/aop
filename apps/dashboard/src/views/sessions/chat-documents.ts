import {
  CHAT_DOCUMENT_LIMITS,
  type ChatDocumentAttachment,
  type ChatDocumentMimeType,
} from "@aop/common";

const extensionOf = (fileName: string): string => fileName.split(".").pop()?.toLowerCase() ?? "";

const mimeTypeForExtension = (extension: string): ChatDocumentMimeType | null => {
  if (extension === "md") return "text/markdown";
  if (extension === "txt") return "text/plain";
  if (extension === "csv") return "text/csv";
  if (extension === "tsv") return "text/tab-separated-values";
  return null;
};

const readFileAsBase64 = async (file: Blob): Promise<string> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

export const fileToChatDocument = async (file: File): Promise<ChatDocumentAttachment> => {
  const extension = extensionOf(file.name);
  const mimeType = mimeTypeForExtension(extension);
  if (!mimeType) {
    throw new Error("Use Markdown (.md), text (.txt), CSV (.csv), or TSV (.tsv) files");
  }
  if (file.size > CHAT_DOCUMENT_LIMITS.maxBytes) {
    throw new Error("Each document must be 256 KB or smaller");
  }
  return {
    id: crypto.randomUUID(),
    fileName: file.name,
    mimeType,
    dataBase64: await readFileAsBase64(file),
  };
};

export const mergeChatDocuments = (
  current: ChatDocumentAttachment[],
  incoming: ChatDocumentAttachment[],
): ChatDocumentAttachment[] | string => {
  const merged = [...current, ...incoming];
  return merged.length <= CHAT_DOCUMENT_LIMITS.maxCount
    ? merged
    : `At most ${CHAT_DOCUMENT_LIMITS.maxCount} documents`;
};
