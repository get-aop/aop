import { CHAT_IMAGE_LIMITS, type UploadedChatImage } from "@aop/common";
import {
  type ClipboardEvent,
  type DragEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/** An image in the composer: uploading, uploaded (it has the host's `id`), or refused. */
export interface PendingImage {
  key: string;
  name: string;
  /** A local preview of the file, valid while the image is in the composer. */
  previewUrl: string;
  status: "uploading" | "ready" | "failed";
  id?: string;
  error?: string;
}

export type UploadImage = (file: File) => Promise<UploadedChatImage>;

const ACCEPTED: readonly string[] = CHAT_IMAGE_LIMITS.allowedMimeTypes;
const MAX_MB = CHAT_IMAGE_LIMITS.maxBytes / (1024 * 1024);

/** What the file picker offers. */
export const IMAGE_ACCEPT = CHAT_IMAGE_LIMITS.allowedMimeTypes.join(",");

/**
 * Which of `files` may join `held` images already in the composer, and why the others may not.
 * Checked here so the person hears at once; the host checks again.
 */
export const admitImages = (
  held: number,
  files: readonly File[],
): { accepted: File[]; error: string | null } => {
  const errors = new Set<string>();
  const accepted: File[] = [];
  for (const file of files) {
    if (!ACCEPTED.includes(file.type)) errors.add("Attach PNG, JPEG, GIF or WebP images");
    else if (file.size > CHAT_IMAGE_LIMITS.maxBytes) {
      errors.add(`${file.name || "The image"} is over ${MAX_MB} MB`);
    } else if (held + accepted.length >= CHAT_IMAGE_LIMITS.maxCount) {
      errors.add(`A message takes up to ${CHAT_IMAGE_LIMITS.maxCount} images`);
    } else accepted.push(file);
  }
  return { accepted, error: errors.size > 0 ? [...errors].join(". ") : null };
};

/** The images of a clipboard or a drop; anything else in it is left to the browser. */
export const imageFilesOf = (data: DataTransfer | null): File[] =>
  [...(data?.files ?? [])].filter((file) => file.type.startsWith("image/"));

/**
 * The images the person attaches to the message they are writing. Each uploads as soon as it
 * is added, so sending only names them; `removeSent` takes them out once a message carried them.
 */
export const useImageAttachments = (upload: UploadImage | undefined) => {
  const [images, setImages] = useState<PendingImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const counter = useRef(0);
  const current = useRef(images);
  current.current = images;

  const patch = useCallback((key: string, change: Partial<PendingImage>) => {
    setImages((list) => list.map((image) => (image.key === key ? { ...image, ...change } : image)));
  }, []);

  const add = useCallback(
    (files: readonly File[]) => {
      if (!upload || files.length === 0) return;
      const { accepted, error } = admitImages(current.current.length, files);
      setError(error);
      const added = accepted.map((file) => ({
        file,
        image: {
          key: `image-${++counter.current}`,
          name: file.name || "Pasted image",
          previewUrl: URL.createObjectURL(file),
          status: "uploading" as const,
        },
      }));
      setImages((list) => [...list, ...added.map(({ image }) => image)]);
      for (const { file, image } of added) {
        upload(file).then(
          (uploaded) => patch(image.key, { status: "ready", id: uploaded.id }),
          (cause: unknown) => {
            const reason = cause instanceof Error ? cause.message : "The upload failed";
            patch(image.key, { status: "failed", error: reason });
            setError(`${image.name} did not upload: ${reason}. Remove it to send.`);
          },
        );
      }
    },
    [upload, patch],
  );

  const remove = useCallback((key: string) => {
    setImages((list) => {
      const gone = list.find((image) => image.key === key);
      if (gone) URL.revokeObjectURL(gone.previewUrl);
      return list.filter((image) => image.key !== key);
    });
  }, []);

  // Only the images a message carried: one added while it was being sent stays for the next.
  const removeSent = useCallback((ids: readonly string[]) => {
    setImages((list) => {
      const sent = list.filter((image) => image.id !== undefined && ids.includes(image.id));
      for (const image of sent) URL.revokeObjectURL(image.previewUrl);
      return list.filter((image) => !sent.includes(image));
    });
    setError(null);
  }, []);

  useEffect(
    () => () => {
      for (const image of current.current) URL.revokeObjectURL(image.previewUrl);
    },
    [],
  );

  return {
    images,
    /** Why the last images added were refused, if any were. */
    error,
    add,
    remove,
    removeSent,
    /** The host's ids of the uploaded images, in the order they were added. */
    readyIds: images.flatMap((image) => (image.status === "ready" && image.id ? [image.id] : [])),
    /**
     * Every image uploaded. One still uploading, or one that failed, would be left out of the
     * message without the person noticing, so a message waits for this.
     */
    settled: images.every((image) => image.status === "ready"),
  };
};

/**
 * Images pasted into the box or dropped on it, while `enabled`. A paste with images attaches
 * them instead of pasting anything; a paste of text alone is left to the browser.
 */
export const useImageInput = (enabled: boolean, add: (files: File[]) => void) => {
  const [dragging, setDragging] = useState(false);

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = imageFilesOf(event.clipboardData);
    if (!enabled || files.length === 0) return;
    event.preventDefault();
    add(files);
  };

  const dropZone = {
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!enabled || !event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      setDragging(true);
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      setDragging(false);
      if (!enabled) return;
      event.preventDefault();
      add(imageFilesOf(event.dataTransfer));
    },
  };

  return { dragging, onPaste, dropZone };
};
