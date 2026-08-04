const FRONTMATTER_REGEX = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/** Returns markdown body only, hiding machine-readable YAML frontmatter from readers. */
export const stripMarkdownFrontmatter = (markdown: string): string =>
  markdown.replace(FRONTMATTER_REGEX, "").trimStart();
