import { useEffect, useState } from "react";
import { fetchChangeFile, fetchChangeFiles, type ReviewNote } from "../api/specs-client";
import type { Task } from "../types";
import { stripMarkdownFrontmatter } from "../utils/markdown-frontmatter";
import { AnnotatedMarkdownViewer } from "./AnnotatedMarkdownViewer";
import { FileTreeFlyout } from "./FileTreeFlyout";

const SPEC_FILE_PRIORITY = ["plan.md", "task.md", "issues.md", "prd.md"];
const DEFAULT_SPEC_FILE_PRIORITY = ["plan.md", "issues.md", "prd.md"];

const sortFilesTasksFirst = (files: string[]): string[] => {
  const sorted = [...files];
  sorted.sort((a, b) => {
    const aPriority = SPEC_FILE_PRIORITY.indexOf(a);
    const bPriority = SPEC_FILE_PRIORITY.indexOf(b);
    if (aPriority !== -1 || bPriority !== -1) {
      if (aPriority === -1) return 1;
      if (bPriority === -1) return -1;
      return aPriority - bPriority;
    }
    return a.localeCompare(b);
  });
  return sorted;
};

const pickDefaultSpecFile = (files: string[]): string => {
  return DEFAULT_SPEC_FILE_PRIORITY.find((file) => files.includes(file)) ?? files[0] ?? "plan.md";
};

interface SpecsTabProps {
  task: Task;
  initialFilePath?: string;
  notes: ReviewNote[];
  onCreateNote: (input: {
    filePath: string;
    selectedText: string;
    textOccurrence?: number;
    note: string;
  }) => Promise<void>;
  onDeleteNote: (noteId: string) => Promise<void>;
  onUpdateNote: (noteId: string, noteText: string) => Promise<void>;
}

export const SpecsTab = ({
  task,
  initialFilePath,
  notes,
  onCreateNote,
  onDeleteNote,
  onUpdateNote,
}: SpecsTabProps) => {
  const [files, setFiles] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState(initialFilePath ?? "plan.md");
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialFilePath) setActiveFile(initialFilePath);
  }, [initialFilePath]);

  useEffect(() => {
    let cancelled = false;

    void fetchChangeFiles(task.repoId, task.id)
      .then((f) => {
        if (cancelled) return;

        const nextFiles = sortFilesTasksFirst(f);
        setFiles(nextFiles);
        setActiveFile((currentFile) => {
          if (nextFiles.length === 0) return currentFile;
          if (nextFiles.includes(currentFile)) return currentFile;
          return pickDefaultSpecFile(nextFiles);
        });
      })
      .catch(() => {
        if (cancelled) return;
        setFiles([]);
      });

    return () => {
      cancelled = true;
    };
  }, [task.repoId, task.id]);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError(null);

    void fetchChangeFile(task.repoId, task.id, activeFile)
      .then((nextContent) => {
        if (cancelled) return;
        setContent(nextContent);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Failed to load file");
        setContent(null);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeFile, task.repoId, task.id]);

  const activeFileNotes = notes.filter((note) => note.filePath === activeFile);

  const handleCreateNote = async (input: {
    selectedText: string;
    textOccurrence?: number;
    note: string;
  }) => {
    await onCreateNote({
      filePath: activeFile,
      selectedText: input.selectedText,
      ...(input.textOccurrence ? { textOccurrence: input.textOccurrence } : {}),
      note: input.note,
    });
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" data-testid="specs-tab">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <SpecsHeader activeFile={activeFile} files={files} onSelectFile={setActiveFile} />

        <SpecsBody
          activeFileNotes={activeFileNotes}
          content={content}
          error={error}
          loading={loading}
          onCreateNote={handleCreateNote}
          onDeleteNote={onDeleteNote}
          onUpdateNote={onUpdateNote}
        />
      </div>
    </div>
  );
};

interface SpecsHeaderProps {
  activeFile: string;
  files: string[];
  onSelectFile: (path: string) => void;
}

const SpecsHeader = ({ activeFile, files, onSelectFile }: SpecsHeaderProps) => (
  <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
    <div className="flex items-center gap-2">
      <FileTreeFlyout files={files} activeFile={activeFile} onSelectFile={onSelectFile} />
      <span className="font-mono text-xs text-text-muted">{activeFile}</span>
    </div>
  </div>
);

interface SpecsBodyProps {
  activeFileNotes: ReviewNote[];
  content: string | null;
  error: string | null;
  loading: boolean;
  onCreateNote: (input: {
    selectedText: string;
    textOccurrence?: number;
    note: string;
  }) => Promise<void>;
  onDeleteNote: (noteId: string) => Promise<void>;
  onUpdateNote: (noteId: string, noteText: string) => Promise<void>;
}

const SpecsBody = ({
  activeFileNotes,
  content,
  error,
  loading,
  onCreateNote,
  onDeleteNote,
  onUpdateNote,
}: SpecsBodyProps) => (
  <div className="flex-1 overflow-auto">
    <SpecsBodyContent
      activeFileNotes={activeFileNotes}
      content={content}
      error={error}
      loading={loading}
      onCreateNote={onCreateNote}
      onDeleteNote={onDeleteNote}
      onUpdateNote={onUpdateNote}
    />
  </div>
);

const SpecsBodyContent = ({
  activeFileNotes,
  content,
  error,
  loading,
  onCreateNote,
  onDeleteNote,
  onUpdateNote,
}: SpecsBodyProps) => {
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="font-sans text-sm text-text-muted">Loading...</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="font-sans text-sm text-blocked">{error}</span>
      </div>
    );
  }
  if (content === null) return null;

  return (
    <AnnotatedMarkdownViewer
      content={stripMarkdownFrontmatter(content)}
      notes={activeFileNotes}
      onCreateNote={onCreateNote}
      onDeleteNote={onDeleteNote}
      onUpdateNote={onUpdateNote}
    />
  );
};
