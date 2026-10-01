import { CircleAlertIcon, PlusIcon, XIcon } from "lucide-react";
import { useRef } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "@/ui/spinner";
import { IMAGE_ACCEPT, type PendingImage } from "./image-attachments";

/** The images attached to the message being written, each with a cross that takes it out. */
export const ComposerImages = ({
  images,
  onRemove,
}: {
  images: readonly PendingImage[];
  onRemove: (key: string) => void;
}) =>
  images.length === 0 ? null : (
    <ul data-testid="composer-images" className="flex flex-wrap gap-2 px-4 pt-3">
      {images.map((image) => (
        <li
          key={image.key}
          data-testid="composer-image"
          data-status={image.status}
          title={image.error ?? image.name}
          className={cn(
            "relative size-16 overflow-hidden rounded-lg border bg-raised",
            image.status === "failed" ? "border-blocked" : "border-border",
          )}
        >
          <img src={image.previewUrl} alt={image.name} className="size-full object-cover" />
          {image.status === "uploading" ? (
            <span className="absolute inset-0 grid place-items-center bg-black/30">
              <Spinner
                aria-label={`Uploading ${image.name}`}
                className="border-white/40 border-t-white"
              />
            </span>
          ) : null}
          {image.status === "failed" ? (
            <span className="absolute inset-0 grid place-items-center bg-black/40 text-white">
              <CircleAlertIcon aria-label={`${image.name} did not upload`} className="size-5" />
            </span>
          ) : null}
          <button
            type="button"
            data-testid="composer-image-remove"
            aria-label={`Remove ${image.name}`}
            onClick={() => onRemove(image.key)}
            className="absolute top-1 right-1 grid size-5 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80"
          >
            <XIcon aria-hidden="true" className="size-3" strokeWidth={2.5} />
          </button>
        </li>
      ))}
    </ul>
  );

/** The "+" that opens the file picker for images; it sits before the model and effort chips. */
export const AttachImageButton = ({
  disabled,
  onFiles,
}: {
  disabled: boolean;
  onFiles: (files: File[]) => void;
}) => {
  const picker = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        data-testid="composer-attach"
        aria-label="Attach images"
        title="Attach images"
        disabled={disabled}
        onClick={() => picker.current?.click()}
        className="grid size-8 shrink-0 place-items-center rounded-lg text-text-muted transition-colors duration-[120ms] hover:bg-hover hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
      >
        <PlusIcon aria-hidden="true" className="size-4" />
      </button>
      <input
        ref={picker}
        type="file"
        accept={IMAGE_ACCEPT}
        multiple
        hidden
        data-testid="composer-file-input"
        onChange={(event) => {
          onFiles([...(event.target.files ?? [])]);
          // The same file picked twice in a row is still a change.
          event.target.value = "";
        }}
      />
    </>
  );
};
