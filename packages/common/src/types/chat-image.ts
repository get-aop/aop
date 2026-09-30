export const CHAT_IMAGE_LIMITS = {
  maxCount: 5,
  maxBytes: 5 * 1024 * 1024,
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
