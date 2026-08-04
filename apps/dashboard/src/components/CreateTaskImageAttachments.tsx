import { CREATE_TASK_IMAGE_LIMITS } from "@aop/common";
import { XIcon } from "lucide-react";
import type { LocalCreateTaskImage } from "./create-task-images.ts";

interface CreateTaskImageAttachmentsProps {
  images: LocalCreateTaskImage[];
  disabled?: boolean;
  onRemove: (id: string) => void;
}

export const CreateTaskImageAttachments = ({
  images,
  disabled = false,
  onRemove,
}: CreateTaskImageAttachmentsProps) => {
  const pasteModifier = navigator.platform.includes("Mac") ? "Cmd" : "Ctrl";

  return (
    <div className="space-y-2">
      <span className="mb-1 block text-[12px] font-medium text-text-muted">
        Reference images (optional)
      </span>

      {images.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {images.map((image) => (
            <li
              key={image.id}
              className="relative overflow-hidden rounded-control border border-border bg-canvas"
            >
              <img
                src={image.previewUrl}
                alt="Attached reference"
                className="h-20 w-20 object-cover"
              />
              <button
                type="button"
                disabled={disabled}
                aria-label="Remove attached image"
                onClick={() => onRemove(image.id)}
                className="focus-ring absolute right-1 top-1 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-canvas/80 text-text transition-colors hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-60"
              >
                <XIcon className="size-3.5" strokeWidth={1.7} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="font-sans text-xs leading-5 text-text-subtle">
          You can paste a screenshot with {pasteModifier}+V. Add mockups or screenshots so the agent
          can see what you mean. Up to {CREATE_TASK_IMAGE_LIMITS.maxCount} images.
        </p>
      )}
    </div>
  );
};
