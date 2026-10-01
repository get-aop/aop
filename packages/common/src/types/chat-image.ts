export const CHAT_IMAGE_LIMITS = {
  maxCount: 5,
  // Claude Code scales a large image down before it sends it, so this bounds disk and upload
  // time, not what the model accepts.
  maxBytes: 10 * 1024 * 1024,
  allowedMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"] as const,
} as const;

export const imageAttachmentMarker = (position: number): string => `#image${position}`;

export type ChatImageMimeType = (typeof CHAT_IMAGE_LIMITS.allowedMimeTypes)[number];

export interface ChatImageAttachment {
  id: string;
  mimeType: ChatImageMimeType;
  /** Raw base64 payload (no data: URL prefix). */
  dataBase64: string;
}

/** An image uploaded to a project and not sent yet; a message names it by `id`. */
export interface UploadedChatImage {
  id: string;
  mimeType: ChatImageMimeType;
  /** In bytes. */
  size: number;
}
