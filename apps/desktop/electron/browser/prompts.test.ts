import { describe, expect, test } from "bun:test";
import { createPromptRegistry } from "./prompts";

const setup = () => {
  let next = 0;
  const registry = createPromptRegistry(() => `p${++next}`);
  const settled: [string, boolean][] = [];
  const settle = (label: string) => (allow: boolean) => void settled.push([label, allow]);
  return { registry, settled, settle };
};

const camera = { webContentsId: 7, origin: "https://meet.example", ask: "camera" as const };

describe("a page's questions", () => {
  test("wait for the person, and settle with their answer once", () => {
    const { registry, settled, settle } = setup();

    const prompt = registry.ask(camera, settle("a"));
    expect(prompt).toEqual({ ...camera, id: "p1" });
    expect(settled).toEqual([]);

    expect(registry.answer("p1", false)?.id).toBe("p1");
    expect(registry.answer("p1", true)).toBeNull();
    expect(settled).toEqual([["a", false]]);
  });

  test("an Allow lasts for the origin while the app runs; a Block is asked again", () => {
    const { registry, settled, settle } = setup();

    registry.ask(camera, settle("first"));
    registry.answer("p1", true);
    expect(registry.ask(camera, settle("again"))).toBeNull();
    expect(registry.granted("https://meet.example", "camera")).toBe(true);
    expect(registry.granted("https://other.example", "camera")).toBe(false);
    expect(settled).toEqual([
      ["first", true],
      ["again", true],
    ]);

    const geo = { ...camera, ask: "geolocation" as const };
    registry.ask(geo, settle("blocked"));
    registry.answer("p2", false);
    expect(registry.ask(geo, settle("asked"))?.id).toBe("p3");
  });

  test("opening another app is asked every time", () => {
    const { registry, settle } = setup();
    const external = { ...camera, ask: "open-external" as const, externalUrl: "mailto:a@b.c" };

    registry.ask(external, settle("one"));
    registry.answer("p1", true);
    expect(registry.ask(external, settle("two"))?.id).toBe("p2");
  });

  test("a page that moves on or closes has its questions refused", () => {
    const { registry, settled, settle } = setup();

    registry.ask(camera, settle("a"));
    registry.ask({ ...camera, ask: "notifications" }, settle("b"));
    registry.ask({ ...camera, webContentsId: 8 }, settle("other page"));

    expect(registry.cancelFor(7)).toEqual(["p1", "p2"]);
    expect(settled).toEqual([
      ["a", false],
      ["b", false],
    ]);
    expect(registry.answer("p1", true)).toBeNull();
  });
});
