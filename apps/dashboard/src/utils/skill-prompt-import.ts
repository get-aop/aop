export interface ParsedSkillMarkdown {
  name?: string;
  description?: string;
  prompt: string;
}

export class SkillImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillImportError";
  }
}

export interface StepBlockSkillImportUpdates {
  promptTemplate: string;
  id?: string;
  description?: string;
}

export const parseSkillMarkdown = (content: string): ParsedSkillMarkdown => {
  const { frontmatter, body } = splitFrontmatter(content);
  const fields = parseFrontmatter(frontmatter);
  const prompt = body.join("\n").trim();

  return {
    name: fields.get("name"),
    description: fields.get("description"),
    prompt,
  };
};

export const skillNameToBlockId = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);

export const buildStepBlockUpdatesFromSkillMarkdown = (
  content: string,
  current: { id: string; description: string },
): StepBlockSkillImportUpdates => {
  const parsed = parseSkillMarkdown(content);
  if (!parsed.prompt) {
    throw new SkillImportError("The SKILL.md file has no prompt content after frontmatter.");
  }

  return {
    promptTemplate: parsed.prompt,
    ...(current.id.trim().length === 0 && parsed.name
      ? { id: skillNameToBlockId(parsed.name) }
      : {}),
    ...(current.description.trim().length === 0 && parsed.description
      ? { description: parsed.description }
      : {}),
  };
};

export const normalizeSkillMarkdownUrl = (input: string): string => {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new SkillImportError("Enter a SKILL.md URL.");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new SkillImportError("Enter a valid http(s) URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SkillImportError("Only http(s) URLs are supported.");
  }

  if (url.hostname === "github.com") {
    const blobMatch = url.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
    if (blobMatch) {
      const [, owner, repo, rest] = blobMatch;
      return `https://raw.githubusercontent.com/${owner}/${repo}/${rest}`;
    }
  }

  return url.toString();
};

export const fetchSkillMarkdownFromUrl = async (
  input: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> => {
  const url = normalizeSkillMarkdownUrl(input);
  const response = await fetchImpl(url, {
    headers: { Accept: "text/plain, text/markdown, */*" },
  });

  if (!response.ok) {
    throw new SkillImportError(
      `Could not fetch SKILL.md (${response.status} ${response.statusText}).`,
    );
  }

  const content = await response.text();
  if (!content.trim()) {
    throw new SkillImportError("The URL returned empty content.");
  }

  return content;
};

const splitFrontmatter = (content: string): { frontmatter: string[]; body: string[] } => {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") {
    return { frontmatter: [], body: lines };
  }

  const frontmatter: string[] = [];
  const body: string[] = [];
  let inFrontmatter = true;

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (inFrontmatter && line.trim() === "---") {
      inFrontmatter = false;
      continue;
    }

    if (inFrontmatter) {
      frontmatter.push(line);
    } else {
      body.push(line);
    }
  }

  return { frontmatter, body };
};

const parseFrontmatter = (lines: string[]): Map<string, string> => {
  const fields = new Map<string, string>();

  for (const line of lines) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = stripWrappingQuotes(line.slice(separatorIndex + 1).trim());
    if (key) {
      fields.set(key, value);
    }
  }

  return fields;
};

const stripWrappingQuotes = (value: string): string => {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
};
