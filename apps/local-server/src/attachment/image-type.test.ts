import { describe, expect, test } from "bun:test";
import { sniffImageType } from "./image-type.ts";

const bytes = (...values: Array<number | string>): Uint8Array =>
  new Uint8Array(
    values.flatMap((value) =>
      typeof value === "string" ? [...value].map((char) => char.charCodeAt(0)) : [value],
    ),
  );

describe("sniffImageType", () => {
  test("names the four image types by their signatures", () => {
    expect(sniffImageType(bytes(0x89, "PNG\r\n", 0x1a, "\n", 0, 0))).toBe("image/png");
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe1))).toBe("image/jpeg");
    expect(sniffImageType(bytes("GIF89a", 1, 0))).toBe("image/gif");
    expect(sniffImageType(bytes("GIF87a"))).toBe("image/gif");
    expect(sniffImageType(bytes("RIFF", 0, 0, 0, 0, "WEBPVP8 "))).toBe("image/webp");
  });

  test("refuses anything else, whatever it claims to be", () => {
    expect(sniffImageType(bytes("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniffImageType(bytes("<!doctype html><script>"))).toBeNull();
    expect(sniffImageType(bytes("RIFF", 0, 0, 0, 0, "WAVE"))).toBeNull();
    expect(sniffImageType(bytes(0x89, "PN"))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});
