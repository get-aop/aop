import { useEffect, useState } from "react";

/** A URL for bytes held in memory, released when the view lets go of them. */
export const useObjectUrl = (blob: Blob | null, type?: string): string | null => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return;
    const typed = type && blob.type !== type ? new Blob([blob], { type }) : blob;
    const next = URL.createObjectURL(typed);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob, type]);
  return url;
};

/**
 * An image, or an SVG as an image: drawn through `<img>`, where an SVG runs no script and loads
 * nothing, so an agent's SVG is never put into the page itself.
 */
export const ImageView = ({
  blob,
  mimeType,
  alt,
}: {
  blob: Blob;
  mimeType: string;
  alt: string;
}) => {
  const url = useObjectUrl(blob, mimeType);
  return (
    <div
      data-testid={mimeType === "image/svg+xml" ? "artifact-svg" : "artifact-image"}
      className="flex min-h-full items-start justify-center p-6 [background:repeating-conic-gradient(#1b1b1e_0%_25%,#161618_0%_50%)_50%/20px_20px]"
    >
      {url ? <img src={url} alt={alt} className="max-w-full rounded-sm shadow-lg" /> : null}
    </div>
  );
};

/** A PDF in the browser's own viewer; downloading is the way when there is none. */
export const PdfView = ({ blob, title }: { blob: Blob; title: string }) => {
  const url = useObjectUrl(blob, "application/pdf");
  return url ? (
    <iframe
      data-testid="artifact-pdf"
      title={title}
      src={url}
      className="h-full min-h-[70vh] w-full flex-1 border-0"
    />
  ) : null;
};
