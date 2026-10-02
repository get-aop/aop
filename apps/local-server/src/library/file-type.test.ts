import { describe, expect, test } from "bun:test";
import { isTextType, libraryMimeType, servedContentType } from "./file-type.ts";

const text = (value: string): Uint8Array => new TextEncoder().encode(value);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe("libraryMimeType", () => {
  test("trusts the bytes for images and PDFs, whatever the name says", () => {
    expect(libraryMimeType("photo.txt", PNG)).toBe("image/png");
    expect(libraryMimeType("report", text("%PDF-1.4\n"))).toBe("application/pdf");
  });

  test("a name that claims an image the bytes are not is not stored as one", () => {
    expect(libraryMimeType("fake.png", new Uint8Array([0, 1, 2, 3]))).toBe(
      "application/octet-stream",
    );
  });

  test("names the type of text by its extension, and plain text otherwise", () => {
    expect(libraryMimeType("notes.md", text("# hi"))).toBe("text/markdown");
    expect(libraryMimeType("data.csv", text("a,b"))).toBe("text/csv");
    expect(libraryMimeType("diagram.svg", text("<svg/>"))).toBe("image/svg+xml");
    expect(libraryMimeType("main.ts", text("export {}"))).toBe("text/plain");
    expect(libraryMimeType("README", text("héllo ✓"))).toBe("text/plain");
  });

  test("binary is octet-stream, also when its name says text", () => {
    expect(libraryMimeType("data.json", new Uint8Array([0x7b, 0, 0x7d]))).toBe(
      "application/octet-stream",
    );
    expect(libraryMimeType("bad.txt", new Uint8Array([0xc3, 0x28]))).toBe(
      "application/octet-stream",
    );
  });

  test("a multi-byte character cut at the 64 KB mark is still text", () => {
    const long = text(`${"a".repeat(64 * 1024 - 1)}é and more`);
    expect(libraryMimeType("long.txt", long)).toBe("text/plain");
  });
});

describe("servedContentType", () => {
  test("serves markup as inert text and unknown bytes as a download", () => {
    expect(servedContentType("image/png")).toBe("image/png");
    expect(servedContentType("application/pdf")).toBe("application/pdf");
    expect(servedContentType("text/html")).toBe("text/plain; charset=utf-8");
    expect(servedContentType("image/svg+xml")).toBe("text/plain; charset=utf-8");
    expect(servedContentType("application/zip")).toBe("application/octet-stream");
  });

  test("isTextType covers what an agent may read", () => {
    expect(isTextType("text/markdown")).toBe(true);
    expect(isTextType("application/json")).toBe(true);
    expect(isTextType("image/png")).toBe(false);
  });
});
