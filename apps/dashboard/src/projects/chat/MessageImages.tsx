import type { MessageImage } from "@aop/common";
import { ImageOffIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/ui/dialog";
import { Spinner } from "@/ui/spinner";
import { loadApiImage } from "../../api/attachments";

/** The images a person sent with a message, as thumbnails; one opens larger on click. */
export const MessageImages = ({ images }: { images: readonly MessageImage[] }) => {
  const [open, setOpen] = useState<{ image: MessageImage; position: number } | null>(null);
  return (
    <>
      <ul data-testid="message-images" className="flex max-w-[76%] flex-wrap justify-end gap-2">
        {images.map((image, index) => (
          <li key={image.path}>
            <button
              type="button"
              data-testid="message-image"
              aria-label={`Open image ${index + 1}`}
              onClick={() => setOpen({ image, position: index + 1 })}
              className="block h-28 max-w-60 overflow-hidden rounded-lg border border-border bg-raised transition-opacity hover:opacity-90"
            >
              <ApiImage
                path={image.path}
                alt={`Image ${index + 1}`}
                className="h-full w-auto max-w-60 object-cover"
              />
            </button>
          </li>
        ))}
      </ul>
      <Dialog open={open !== null} onOpenChange={(next) => (next ? null : setOpen(null))}>
        {open ? (
          <DialogContent
            data-testid="message-image-viewer"
            className="w-auto max-w-[min(92vw,1400px)] border-0 bg-transparent p-0 shadow-none"
          >
            <DialogTitle className="sr-only">Image {open.position}</DialogTitle>
            <ApiImage
              path={open.image.path}
              alt={`Image ${open.position}`}
              className="max-h-[86vh] max-w-full rounded-lg object-contain"
            />
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
};

/** An image the host serves, fetched with this client's credentials (see `loadApiImage`). */
const ApiImage = ({ path, alt, className }: { path: string; alt: string; className: string }) => {
  const [state, setState] = useState<{ url: string | null; failed: boolean }>({
    url: null,
    failed: false,
  });

  useEffect(() => {
    let current = true;
    setState({ url: null, failed: false });
    loadApiImage(path).then(
      (url) => current && setState({ url, failed: false }),
      () => current && setState({ url: null, failed: true }),
    );
    return () => {
      current = false;
    };
  }, [path]);

  if (state.url) return <img src={state.url} alt={alt} className={className} />;
  return (
    <span
      data-testid={state.failed ? "message-image-missing" : "message-image-loading"}
      className="grid size-full min-h-16 min-w-16 place-items-center text-text-subtle"
      title={state.failed ? "This image could not be loaded" : undefined}
    >
      {state.failed ? (
        <ImageOffIcon aria-label={`${alt} could not be loaded`} className="size-5" />
      ) : (
        <Spinner />
      )}
    </span>
  );
};
