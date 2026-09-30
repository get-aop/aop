import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitFontFiles, findFontFile } from "./font-files";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

const tempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "aop-font-files-"));
  tempDirs.push(dir);
  return dir;
};

// The same Tailwind run as build.ts, so the test sees the urls the real build has to satisfy.
const buildStylesheet = async (): Promise<string> =>
  Bun.$`${join(import.meta.dir, "node_modules/.bin/tailwindcss")} -i ./src/index.css`
    .cwd(import.meta.dir)
    .quiet()
    .text();

const isWoff2 = async (path: string): Promise<boolean> =>
  new TextDecoder().decode((await Bun.file(path).bytes()).slice(0, 4)) === "wOF2";

describe("emitFontFiles", () => {
  test("copies every file the built stylesheet points at, so each url resolves in the output", async () => {
    const css = await buildStylesheet();
    const out = await tempDir();

    const emitted = emitFontFiles(css, out);

    expect(emitted).toContain("./files/inter-latin-wght-normal.woff2");
    expect(emitted).toContain("./files/geist-mono-latin-400-normal.woff2");
    expect(emitted).toContain("./files/geist-mono-latin-500-normal.woff2");
    const urls = Array.from(css.matchAll(/url\(([^)]+)\)/g), ([, url = ""]) => url);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.filter((url) => !existsSync(join(out, url)))).toEqual([]);
    expect(await isWoff2(join(out, "files/inter-latin-wght-normal.woff2"))).toBe(true);
  });

  test("fails when the stylesheet points at a file no imported package has", async () => {
    const out = await tempDir();

    expect(() => emitFontFiles("a{src:url(./files/nope.woff2)}", out)).toThrow(
      "The stylesheet points at ./files/nope.woff2, but no imported @fontsource package has it.",
    );
  });

  test("fails when a url leaves the output folder", async () => {
    const out = await tempDir();

    expect(() => emitFontFiles("a{src:url(../node_modules/x.woff2)}", out)).toThrow("outside");
  });

  test("leaves data, absolute, remote, fragment and variable urls alone", async () => {
    const out = await tempDir();
    const css = [
      "a{src:url(data:font/woff2;base64,AA==)}",
      'b{background:url("/icon.svg")}',
      "c{src:url(https://example.com/x.woff2)}",
      "d{filter:url(#glow)}",
      "e{mask:url(var(--mask))}",
    ].join("");

    expect(emitFontFiles(css, out)).toEqual([]);
    expect(await readdir(out)).toEqual([]);
  });
});

describe("findFontFile", () => {
  test("finds a file under a package folder and nothing outside it", async () => {
    const root = await tempDir();
    const pkg = join(root, "pkg");
    await mkdir(join(pkg, "files"), { recursive: true });
    await writeFile(join(pkg, "files/a.woff2"), "font");
    await writeFile(join(root, "secret.txt"), "secret");

    expect(findFontFile("files/a.woff2", [pkg])).toBe(join(pkg, "files/a.woff2"));
    expect(findFontFile("files/b.woff2", [pkg])).toBeNull();
    expect(findFontFile("../secret.txt", [pkg])).toBeNull();
  });
});
