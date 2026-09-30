import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

/**
 * The dashboard's stylesheet imports its fonts from @fontsource packages. The Tailwind CLI inlines
 * those stylesheets but not the files they point at: each face keeps its `url(./files/<name>)`,
 * which a browser now resolves next to the dashboard's own stylesheet (`/index.css` in a build,
 * `/src/index.css` in dev) instead of next to the package's. The build copies each such file
 * there, and the dev server answers for it from the package.
 */

const SOURCE_STYLESHEET = join(import.meta.dir, "src/index.css");

const FONTSOURCE_IMPORT = /@import\s+["'](@fontsource[^"']*)["']/g;

// A url() without a scheme or a leading `/` or `#` is relative to the stylesheet that holds it.
// `(` is excluded so `url(var(--x))` is not read as a path.
const RELATIVE_URL = /url\(\s*(["']?)(?![a-z][a-z0-9+.-]*:|\/|#)([^"'()\s]+)\1\s*\)/gi;

/** The folders of the @fontsource stylesheets the dashboard imports: their `url()`s start there. */
export const fontSourceDirs = (stylesheetPath = SOURCE_STYLESHEET): string[] => {
  const css = readFileSync(stylesheetPath, "utf-8");
  const from = dirname(stylesheetPath);
  const dirs = Array.from(css.matchAll(FONTSOURCE_IMPORT), ([, specifier = ""]) =>
    dirname(Bun.resolveSync(specifier, from)),
  );
  return [...new Set(dirs)];
};

/** The file a stylesheet-relative path (`files/inter-latin-wght-normal.woff2`) names, or null. */
export const findFontFile = (relativePath: string, dirs: readonly string[]): string | null => {
  for (const dir of dirs) {
    const path = resolve(dir, relativePath);
    if (isInside(dir, path) && existsSync(path)) return path;
  }
  return null;
};

/**
 * Copies every file the built stylesheet points at into `outDir`, where its relative `url()`s now
 * resolve, and returns their paths. Fails the build when a url leaves `outDir` or names a file no
 * imported package has: a font the build drops would otherwise only show as a fallback typeface.
 */
export const emitFontFiles = (
  css: string,
  outDir: string,
  dirs: readonly string[] = fontSourceDirs(),
): string[] => {
  const urls = [...new Set(Array.from(css.matchAll(RELATIVE_URL), ([, , url = ""]) => url))];
  for (const url of urls) {
    const target = resolve(outDir, url);
    if (!isInside(outDir, target)) {
      throw new Error(`The stylesheet points at ${url}, outside ${outDir}.`);
    }
    const source = findFontFile(url, dirs);
    if (!source) {
      throw new Error(
        `The stylesheet points at ${url}, but no imported @fontsource package has it.`,
      );
    }
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
  return urls;
};

const isInside = (dir: string, path: string): boolean => {
  const inside = relative(resolve(dir), path);
  return inside !== "" && !inside.startsWith("..") && !isAbsolute(inside);
};
