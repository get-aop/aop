import type { ArtifactDetail } from "@aop/common";

/** Saves bytes as a file through the browser's own download. */
export const downloadBlob = (blob: Blob, name: string): void => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
};

/** The file name a version downloads as: the Library's name, with `-v2` for an older version. */
export const downloadName = (detail: ArtifactDetail, version: number): string => {
  if (!detail.versioned || version === detail.currentVersion) return detail.name;
  const dot = detail.name.lastIndexOf(".");
  return dot > 0
    ? `${detail.name.slice(0, dot)}-v${version}${detail.name.slice(dot)}`
    : `${detail.name}-v${version}`;
};

/** Copies an image as an image, where the browser can; anything else as its text. */
export const copyContent = async (blob: Blob, text: string | null): Promise<void> => {
  if (text !== null) {
    await navigator.clipboard.writeText(text);
    return;
  }
  await navigator.clipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
};

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
