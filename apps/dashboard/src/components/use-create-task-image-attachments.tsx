import { CREATE_TASK_IMAGE_LIMITS } from "@aop/common";
import { type ClipboardEvent, type ReactNode, useRef } from "react";
import { Button } from "@/ui/button";
import type { LocalCreateTaskImage } from "./create-task-images.ts";
import {
  clipboardHasImage,
  clipboardItemsToLocalCreateTaskImages,
  fileToLocalCreateTaskImage,
  mergeLocalCreateTaskImages,
  revokeLocalCreateTaskImages,
} from "./create-task-images.ts";

interface UseCreateTaskImageAttachmentsOptions {
  images: LocalCreateTaskImage[];
  disabled?: boolean;
  onChange: (images: LocalCreateTaskImage[]) => void;
  onError: (message: string | null) => void;
}

export const useCreateTaskImageAttachments = ({
  images,
  disabled = false,
  onChange,
  onError,
}: UseCreateTaskImageAttachmentsOptions) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addImages = (incoming: LocalCreateTaskImage[]) => {
    if (incoming.length === 0) {
      return;
    }

    const merged = mergeLocalCreateTaskImages(images, incoming);
    if (typeof merged === "string") {
      onError(merged);
      return;
    }

    onError(null);
    onChange(merged);
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) {
      return;
    }

    try {
      const incoming: LocalCreateTaskImage[] = [];
      for (const file of files) {
        incoming.push(await fileToLocalCreateTaskImage(file));
      }
      addImages(incoming);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to add image");
    }
  };

  const handlePaste = async (event: ClipboardEvent) => {
    const items = event.clipboardData?.items;
    if (disabled || !items || !clipboardHasImage(items)) {
      return;
    }

    event.preventDefault();
    try {
      addImages(await clipboardItemsToLocalCreateTaskImages(items));
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to paste image");
    }
  };

  const removeImage = (id: string) => {
    const target = images.find((image) => image.id === id);
    if (target) {
      revokeLocalCreateTaskImages([target]);
    }
    onChange(images.filter((image) => image.id !== id));
  };

  const attachButton: ReactNode = (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept={CREATE_TASK_IMAGE_LIMITS.allowedMimeTypes.join(",")}
        multiple
        className="hidden"
        aria-label="Attach reference images"
        disabled={disabled}
        onChange={(event) => {
          void handleFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <Button
        variant="secondary"
        size="sm"
        disabled={disabled || images.length >= CREATE_TASK_IMAGE_LIMITS.maxCount}
        onClick={() => fileInputRef.current?.click()}
      >
        Attach image
      </Button>
    </>
  );

  return { attachButton, handlePaste, removeImage };
};
