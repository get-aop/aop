import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ChatSessionMessageImage } from "../../api/client";

export const ChatImageGallery = ({ images }: { images: ChatSessionMessageImage[] }) => {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const selected = selectedIndex === null ? null : images[selectedIndex];

  useEffect(() => {
    if (selectedIndex === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedIndex(null);
      if (event.key === "ArrowLeft") {
        setSelectedIndex((index) =>
          index === null ? null : (index - 1 + images.length) % images.length,
        );
      }
      if (event.key === "ArrowRight") {
        setSelectedIndex((index) => (index === null ? null : (index + 1) % images.length));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [images.length, selectedIndex]);

  if (images.length === 0) return null;

  return (
    <>
      <div className="mb-2 grid max-w-[420px] grid-cols-2 gap-2">
        {images.map((image, index) => (
          <button
            type="button"
            key={image.id}
            aria-label={`Preview attachment ${index + 1}`}
            onClick={() => setSelectedIndex(index)}
            className="cursor-zoom-in overflow-hidden rounded-lg border border-border/80 bg-background/70"
          >
            <img
              src={image.url}
              alt={`Attachment ${index + 1}`}
              className="block h-auto max-h-[220px] w-full object-cover"
            />
          </button>
        ))}
      </div>
      {selected && typeof document !== "undefined"
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Image preview"
              className="fixed inset-0 z-[2000] grid place-items-center bg-black/85 p-6 backdrop-blur-sm"
              onMouseDown={(event) => {
                if (event.currentTarget === event.target) setSelectedIndex(null);
              }}
            >
              <button
                type="button"
                aria-label="Close image preview"
                onClick={() => setSelectedIndex(null)}
                className="absolute right-5 top-5 grid size-9 place-items-center rounded-full border border-white/15 bg-black/40 text-white hover:bg-black/65"
              >
                <XIcon className="size-4" />
              </button>
              {images.length > 1 ? (
                <button
                  type="button"
                  aria-label="Previous image"
                  onClick={() =>
                    setSelectedIndex((index) =>
                      index === null ? null : (index - 1 + images.length) % images.length,
                    )
                  }
                  className="absolute left-5 grid size-10 place-items-center rounded-full border border-white/15 bg-black/40 text-white hover:bg-black/65"
                >
                  <ChevronLeftIcon className="size-5" />
                </button>
              ) : null}
              <img
                src={selected.url}
                alt={`Attachment ${(selectedIndex ?? 0) + 1}`}
                className="max-h-[86vh] max-w-[88vw] rounded-xl object-contain shadow-2xl"
              />
              {images.length > 1 ? (
                <>
                  <button
                    type="button"
                    aria-label="Next image"
                    onClick={() =>
                      setSelectedIndex((index) =>
                        index === null ? null : (index + 1) % images.length,
                      )
                    }
                    className="absolute right-5 grid size-10 place-items-center rounded-full border border-white/15 bg-black/40 text-white hover:bg-black/65"
                  >
                    <ChevronRightIcon className="size-5" />
                  </button>
                  <div className="absolute bottom-5 rounded-full bg-black/55 px-3 py-1 text-xs text-white/80">
                    {(selectedIndex ?? 0) + 1} / {images.length}
                  </div>
                </>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
};
