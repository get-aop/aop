import { parse, stringify } from "yaml";

export interface ParsedDocument<T> {
  frontmatter: T;
  content: string;
}

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export const stripFrontmatterContent = (markdown: string): string => {
  const match = markdown.match(FRONTMATTER_REGEX);
  return match ? (match[2] ?? "").trimStart() : markdown;
};

export const compactFrontmatterValues = <T extends Record<string, unknown>>(frontmatter: T): T => {
  const compacted = {} as T;

  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (value === "") continue;
    compacted[key as keyof T] = value as T[keyof T];
  }

  return compacted;
};

export const parseFrontmatter = <T>(markdown: string): ParsedDocument<T> => {
  const match = markdown.match(FRONTMATTER_REGEX);
  if (!match) {
    throw new Error("Invalid frontmatter: missing or malformed delimiters");
  }

  return {
    frontmatter: parse(match[1] ?? "") as T,
    content: match[2] ?? "",
  };
};

export const serializeFrontmatter = <T extends Record<string, unknown>>(
  doc: ParsedDocument<T>,
): string => {
  const yamlContent = stringify(compactFrontmatterValues(doc.frontmatter)).trim();
  return `---\n${yamlContent}\n---\n${doc.content}`;
};

export const updateFrontmatter = async <T extends Record<string, unknown>>(
  filePath: string,
  updater: (current: T) => T,
): Promise<void> => {
  const markdown = await Bun.file(filePath).text();
  const { frontmatter, content } = parseFrontmatter<T>(markdown);
  await Bun.write(
    filePath,
    serializeFrontmatter({
      frontmatter: updater(frontmatter),
      content,
    }),
  );
};
