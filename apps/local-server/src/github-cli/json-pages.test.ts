import { describe, expect, test } from "bun:test";
import { parseJsonPages } from "./json-pages.ts";

describe("parseJsonPages", () => {
  test("reads one page, an empty one and surrounding whitespace", () => {
    expect(parseJsonPages('[{"id":1},{"id":2}]\n')).toEqual([{ id: 1 }, { id: 2 }]);
    expect(parseJsonPages("[]")).toEqual([]);
    expect(parseJsonPages("  \n")).toEqual([]);
  });

  test("joins the pages gh prints one after another, in order", () => {
    expect(parseJsonPages('[{"id":1}]\n[{"id":2},{"id":3}][{"id":4}]')).toEqual([
      { id: 1 },
      { id: 2 },
      { id: 3 },
      { id: 4 },
    ]);
  });

  test("is not fooled by brackets, quotes and escapes inside a string", () => {
    const body = 'closes ][ and "quotes" and \\ and {braces}';
    const page = JSON.stringify([
      { id: 1, body },
      { id: 2, body: "next" },
    ]);

    expect(parseJsonPages(`${page}${page}`)).toEqual([
      { id: 1, body },
      { id: 2, body: "next" },
      { id: 1, body },
      { id: 2, body: "next" },
    ]);
  });

  test("gives up on anything that is not a run of arrays", () => {
    expect(parseJsonPages('{"message":"Not Found"}')).toBeNull();
    expect(parseJsonPages('[{"id":1}')).toBeNull();
    expect(parseJsonPages('[{"id":1}]]')).toBeNull();
    expect(parseJsonPages("[1,,2]")).toBeNull();
  });
});
