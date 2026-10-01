import { describe, expect, test } from "bun:test";
import { CHAT_IMAGE_LIMITS } from "@aop/common";
import { admitImages, imageFilesOf } from "./image-attachments";

const file = (name: string, type: string, size = 10) =>
  new File([new Uint8Array(size)], name, { type });

describe("admitImages", () => {
  test("takes PNG, JPEG, GIF and WebP images up to the size limit", () => {
    const files = [
      file("a.png", "image/png"),
      file("b.jpg", "image/jpeg"),
      file("c.gif", "image/gif"),
      file("d.webp", "image/webp", CHAT_IMAGE_LIMITS.maxBytes),
    ];

    expect(admitImages(0, files)).toEqual({ accepted: files, error: null });
  });

  test("says why it leaves the others out, once per reason", () => {
    const svg = file("logo.svg", "image/svg+xml");
    const huge = file("huge.png", "image/png", CHAT_IMAGE_LIMITS.maxBytes + 1);
    const ok = file("ok.png", "image/png");

    expect(admitImages(0, [svg, svg, huge, ok])).toEqual({
      accepted: [ok],
      error: "Attach PNG, JPEG, GIF or WebP images. huge.png is over 10 MB",
    });
  });

  test("counts the images already held against the limit", () => {
    const files = [file("a.png", "image/png"), file("b.png", "image/png")];

    expect(admitImages(CHAT_IMAGE_LIMITS.maxCount - 1, files)).toEqual({
      accepted: files.slice(0, 1),
      error: "A message takes up to 5 images",
    });
  });
});

describe("imageFilesOf", () => {
  test("keeps the images of a clipboard or a drop and nothing else", () => {
    const image = file("a.png", "image/png");
    const data = { files: [image, file("notes.txt", "text/plain")] } as unknown as DataTransfer;

    expect(imageFilesOf(data)).toEqual([image]);
    expect(imageFilesOf(null)).toEqual([]);
  });
});
