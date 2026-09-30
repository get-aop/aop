import { CHAT_IMAGE_LIMITS, type ChatImageAttachment, type ChatImageMimeType } from "@aop/common";

export interface LocalCreateTaskImage extends ChatImageAttachment {
  previewUrl: string;
}

const isAllowedMimeType = (mimeType: string): mimeType is ChatImageMimeType =>
  (CHAT_IMAGE_LIMITS.allowedMimeTypes as readonly string[]).includes(mimeType);

const readFileAsBase64 = async (file: Blob): Promise<string> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};

const toLocalImage = async (
  file: Blob,
  mimeType: ChatImageMimeType,
): Promise<LocalCreateTaskImage> => {
  if (file.size > CHAT_IMAGE_LIMITS.maxBytes) {
    throw new Error(
      `Each image must be ${Math.round(CHAT_IMAGE_LIMITS.maxBytes / (1024 * 1024))} MB or smaller`,
    );
  }

  const dataBase64 = await readFileAsBase64(file);
  const id = crypto.randomUUID();

  return {
    id,
    mimeType,
    dataBase64,
    previewUrl: URL.createObjectURL(file),
  };
};

export const revokeLocalCreateTaskImages = (images: LocalCreateTaskImage[]): void => {
  for (const image of images) {
    URL.revokeObjectURL(image.previewUrl);
  }
};

export const localImageToAttachment = (image: LocalCreateTaskImage): ChatImageAttachment => ({
  id: image.id,
  mimeType: image.mimeType,
  dataBase64: image.dataBase64,
});

export const fileToLocalCreateTaskImage = async (file: File): Promise<LocalCreateTaskImage> => {
  if (!isAllowedMimeType(file.type)) {
    throw new Error("Use PNG, JPEG, WebP, or GIF images");
  }

  return toLocalImage(file, file.type);
};

export const clipboardItemsToLocalCreateTaskImages = async (
  items: DataTransferItemList,
): Promise<LocalCreateTaskImage[]> => {
  const images: LocalCreateTaskImage[] = [];

  for (const item of items) {
    if (!item.type.startsWith("image/")) {
      continue;
    }

    if (!isAllowedMimeType(item.type)) {
      continue;
    }

    const file = item.getAsFile();
    if (!file) {
      continue;
    }

    images.push(await toLocalImage(file, item.type));
  }

  return images;
};

export const mergeLocalCreateTaskImages = (
  current: LocalCreateTaskImage[],
  incoming: LocalCreateTaskImage[],
): LocalCreateTaskImage[] | string => {
  const merged = [...current, ...incoming];
  if (merged.length > CHAT_IMAGE_LIMITS.maxCount) {
    revokeLocalCreateTaskImages(incoming);
    return `At most ${CHAT_IMAGE_LIMITS.maxCount} images`;
  }

  return merged;
};
