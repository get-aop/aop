import { type ReactNode, useRef, useState } from "react";
import { Button } from "@/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/ui/toggle-group";
import {
  CREATE_TASK_IDEA_VIEW_LABELS,
  type CreateTaskIdeaView,
  readCreateTaskIdeaImport,
} from "./create-task-idea-editor";
import { MarkdownViewer } from "./MarkdownViewer";

const EDITOR_FIELD_BASE =
  "w-full resize-y rounded-control border border-border bg-surface px-4 py-3 leading-relaxed text-text placeholder:text-text-subtle focus-ring transition-colors disabled:cursor-not-allowed disabled:opacity-60";
const PROSE_FIELD_CLASS = `${EDITOR_FIELD_BASE} font-sans text-sm`;
const SOURCE_FIELD_CLASS = `${EDITOR_FIELD_BASE} font-mono text-xs`;

const VIEW_OPTIONS = Object.keys(CREATE_TASK_IDEA_VIEW_LABELS) as CreateTaskIdeaView[];

interface CreateTaskIdeaEditorProps {
  value: string;
  disabled?: boolean;
  leadingToolbarActions?: ReactNode;
  onChange: (value: string) => void;
  onError: (message: string | null) => void;
}

export const CreateTaskIdeaEditor = ({
  value,
  disabled = false,
  leadingToolbarActions,
  onChange,
  onError,
}: CreateTaskIdeaEditorProps) => {
  const [view, setView] = useState<CreateTaskIdeaView>("text");
  const markdownInputRef = useRef<HTMLInputElement>(null);
  const htmlInputRef = useRef<HTMLInputElement>(null);

  const importFile = async (file: File | undefined, kind: "md" | "html") => {
    if (!file) {
      return;
    }

    try {
      const imported = await readCreateTaskIdeaImport(file, kind);
      onChange(imported.content);
      setView(imported.view);
      onError(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to import file");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup
          type="single"
          aria-label="Description format"
          value={view}
          onValueChange={(next) => {
            if (next) setView(next as CreateTaskIdeaView);
          }}
          disabled={disabled}
        >
          {VIEW_OPTIONS.map((value) => (
            <ToggleGroupItem key={value} value={value}>
              {CREATE_TASK_IDEA_VIEW_LABELS[value]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <div className="flex flex-wrap items-center gap-2">
          {leadingToolbarActions}
          <input
            ref={markdownInputRef}
            type="file"
            accept=".md,text/markdown"
            className="hidden"
            aria-label="Import Markdown file"
            disabled={disabled}
            onChange={(event) => {
              void importFile(event.target.files?.[0], "md");
              event.target.value = "";
            }}
          />
          <input
            ref={htmlInputRef}
            type="file"
            accept=".html,.htm,text/html"
            className="hidden"
            aria-label="Import HTML file"
            disabled={disabled}
            onChange={(event) => {
              void importFile(event.target.files?.[0], "html");
              event.target.value = "";
            }}
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={disabled}
            onClick={() => markdownInputRef.current?.click()}
          >
            Import .md
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={disabled}
            onClick={() => htmlInputRef.current?.click()}
          >
            Import .html
          </Button>
        </div>
      </div>

      <div role="tabpanel">
        {view === "text" ? (
          <label className="block">
            <span className="sr-only">Task description</span>
            <textarea
              aria-label="Task description"
              rows={8}
              value={value}
              disabled={disabled}
              onChange={(event) => onChange(event.target.value)}
              className={PROSE_FIELD_CLASS}
              placeholder="Describe the outcome, user, or problem the agent should tackle..."
            />
          </label>
        ) : null}

        {view === "md" ? (
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-text-muted">
                Markdown source
              </span>
              <textarea
                aria-label="Task description"
                rows={6}
                value={value}
                disabled={disabled}
                onChange={(event) => onChange(event.target.value)}
                className={SOURCE_FIELD_CLASS}
                placeholder="Write Markdown or import a .md file..."
              />
            </label>
            {value.trim() ? (
              <div className="rounded-card border border-border bg-raised p-4">
                <span className="mb-2 block text-[12px] font-medium text-text-muted">Preview</span>
                <MarkdownViewer content={value} />
              </div>
            ) : null}
          </div>
        ) : null}

        {view === "html" ? (
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-text-muted">
                HTML source
              </span>
              <textarea
                aria-label="Task description"
                rows={6}
                value={value}
                disabled={disabled}
                onChange={(event) => onChange(event.target.value)}
                className={SOURCE_FIELD_CLASS}
                placeholder="Paste HTML or import an .html file..."
              />
            </label>
            {value.trim() ? (
              <div className="rounded-card border border-border bg-surface p-1">
                <span className="mb-2 block px-3 pt-2 text-[12px] font-medium text-text-muted">
                  Preview
                </span>
                <iframe
                  title="HTML preview"
                  sandbox=""
                  srcDoc={value}
                  className="h-52 w-full rounded-control border-0 bg-white"
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
};
