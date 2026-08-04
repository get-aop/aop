import { dirname, join } from "node:path";
import { clearMethodologyCache, resolveMethodologyPartial } from "./methodology-loader.ts";

export const INLINE_TEMPLATE_PREFIX = "inline:";

export interface TemplateLoader {
  load: (filename: string) => Promise<string>;
  clearCache: () => void;
}

const SOURCE_TEMPLATES_DIR = join(dirname(import.meta.path), "templates");

const loadPartialContent = async (partialName: string): Promise<string> => {
  const methodologyContent = await resolveMethodologyPartial(partialName);
  if (methodologyContent !== null) {
    return methodologyContent;
  }

  const partialPath = await resolveTemplateFile(`_${partialName}.md.hbs`);
  if (!partialPath) {
    throw new Error(`Partial not found: ${partialName}`);
  }

  return (await Bun.file(partialPath).text()).trimEnd();
};

/**
 * The canonical signals boilerplate, exposed so the executor can append it to
 * custom step templates that define signals but omit the section themselves.
 */
export const loadOutputSignalsSection = (): Promise<string> => loadPartialContent("output-signals");

const resolvePartials = async (content: string): Promise<string> => {
  const partialPattern = /\{\{>\s*(\S+)\s*\}\}/g;
  let resolved = content;

  while (true) {
    const matches = [...resolved.matchAll(partialPattern)];
    if (matches.length === 0) {
      return resolved;
    }

    for (const match of matches) {
      const partialName = match[1];
      if (!partialName) {
        continue;
      }
      const partialContent = await loadPartialContent(partialName);
      resolved = resolved.replace(match[0], partialContent);
    }
  }
};

/**
 * Renamed template files. Saved user workflows reference templates by filename,
 * so renames must keep resolving for definitions persisted before the rename.
 */
const LEGACY_TEMPLATE_ALIASES: Record<string, string> = {
  "cleanup-review.md.hbs": "simplification.md.hbs",
  "review.md.hbs": "nuclear-review.md.hbs",
};

export const createTemplateLoader = (): TemplateLoader => {
  const cache = new Map<string, string>();

  return {
    load: async (requestedFilename: string): Promise<string> => {
      if (requestedFilename.startsWith(INLINE_TEMPLATE_PREFIX)) {
        return requestedFilename.slice(INLINE_TEMPLATE_PREFIX.length);
      }

      const filename = LEGACY_TEMPLATE_ALIASES[requestedFilename] ?? requestedFilename;
      const cached = cache.get(filename);
      if (cached) {
        return cached;
      }

      const filePath = await resolveTemplateFile(filename);
      if (!filePath) {
        throw new Error(`Template not found: ${filename}`);
      }

      const content = await Bun.file(filePath).text();
      const resolved = await resolvePartials(content);
      cache.set(filename, resolved);

      return resolved;
    },

    clearCache: () => {
      cache.clear();
      clearMethodologyCache();
    },
  };
};

const resolveTemplateFile = async (filename: string): Promise<string | null> => {
  for (const dir of getTemplateDirs()) {
    const filePath = join(dir, filename);
    if (await Bun.file(filePath).exists()) {
      return filePath;
    }
  }

  return null;
};

const getTemplateDirs = (): string[] => {
  const dirs = [
    process.env.AOP_TEMPLATES_DIR,
    join(dirname(process.execPath), "templates"),
    SOURCE_TEMPLATES_DIR,
  ].filter((dir): dir is string => Boolean(dir));

  return [...new Set(dirs)];
};
