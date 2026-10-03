import { describe, expect, test } from "bun:test";
import { createMpjpegParser } from "./mpjpeg.ts";
import { mpjpegPart } from "./test-utils.ts";

describe("createMpjpegParser", () => {
  test("splits ffmpeg's multipart output into whole JPEGs, however the chunks cut it", () => {
    const first = new Uint8Array([0xff, 0xd8, 0x0d, 0x0a, 0x0d, 0x0a, 0xff, 0xd9]);
    const second = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
    const stream = new Uint8Array([...mpjpegPart(first), ...mpjpegPart(second)]);
    const frames: number[][] = [];
    const parser = createMpjpegParser((jpeg) => frames.push([...jpeg]));

    for (let i = 0; i < stream.length; i += 5) parser.push(stream.subarray(i, i + 5));

    expect(frames).toEqual([[...first], [...second]]);
  });

  test("waits for the rest of a part before emitting it", () => {
    const frames: Uint8Array[] = [];
    const parser = createMpjpegParser((jpeg) => frames.push(jpeg));
    const part = mpjpegPart(new Uint8Array([1, 2, 3, 4]));

    parser.push(part.subarray(0, part.length - 4));
    expect(frames.length).toBe(0);
    parser.push(part.subarray(part.length - 4));
    expect(frames.length).toBe(1);
  });
});
