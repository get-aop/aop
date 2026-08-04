export type CreateTaskIdeaView = "text" | "md" | "html";

export const CREATE_TASK_IDEA_VIEW_LABELS: Record<CreateTaskIdeaView, string> = {
  text: "Text",
  md: "Markdown",
  html: "HTML",
};

export const CREATE_TASK_IDEA_MAX_IMPORT_BYTES = 512_000;

const normalizeExtension = (filename: string): string => {
  const lower = filename.trim().toLowerCase();
  const dotIndex = lower.lastIndexOf(".");
  return dotIndex >= 0 ? lower.slice(dotIndex) : "";
};

export const readCreateTaskIdeaImport = async (
  file: File,
  kind: "md" | "html",
): Promise<{ content: string; view: CreateTaskIdeaView }> => {
  const extension = normalizeExtension(file.name);

  if (kind === "md" && extension !== ".md") {
    throw new Error("Select a Markdown file (.md)");
  }

  if (kind === "html" && extension !== ".html" && extension !== ".htm") {
    throw new Error("Select an HTML file (.html or .htm)");
  }

  if (file.size > CREATE_TASK_IDEA_MAX_IMPORT_BYTES) {
    throw new Error("File must be 500 KB or smaller");
  }

  const content = (await file.text()).trim();
  if (!content) {
    throw new Error("File is empty");
  }

  return { content, view: kind === "md" ? "md" : "html" };
};
