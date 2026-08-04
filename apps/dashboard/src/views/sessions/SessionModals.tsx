import { useEffect, useRef } from "react";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/ui/dialog";
import { Input } from "@/ui/input";

interface SessionTextModalProps {
  open: boolean;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

export const RenameSessionModal = (props: SessionTextModalProps) => (
  <SessionTextModal
    {...props}
    title="Rename session"
    inputLabel="Session name"
    placeholder="Session name"
  />
);

const SessionTextModal = ({
  open,
  value,
  onChange,
  onSave,
  onCancel,
  title,
  inputLabel,
  placeholder,
  description,
  footnote,
  mono = false,
}: SessionTextModalProps & {
  title: string;
  inputLabel: string;
  placeholder: string;
  description?: React.ReactNode;
  footnote?: string;
  mono?: boolean;
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent aria-label={title} className="w-[min(380px,92vw)] max-w-[380px]">
        <div className="px-5 pb-4 pt-5">
          <h2 className="text-lg font-semibold text-text">{title}</h2>
          {description ? <p className="mt-2 text-[13px] text-text-muted">{description}</p> : null}
          <Input
            ref={inputRef}
            aria-label={inputLabel}
            value={value}
            spellCheck={!mono}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onSave();
              } else if (event.key === "Escape") {
                event.preventDefault();
                onCancel();
              }
            }}
            placeholder={placeholder}
            className={`mt-3 w-full ${mono ? "font-mono text-[12px]" : ""}`}
          />
          {footnote ? <p className="mt-2 text-[11.5px] text-text-subtle">{footnote}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={onSave}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export interface SessionToastLink {
  url: string;
  label: string;
}

export interface SessionToastContent {
  message: string;
  link?: SessionToastLink;
}

export const SessionToast = ({ toast }: { toast: SessionToastContent | null }) =>
  toast ? (
    <div
      role="status"
      data-testid="session-toast"
      className="aop-in fixed bottom-5 left-1/2 z-[var(--z-toast)] -translate-x-1/2 rounded-control bg-text px-4 py-3 text-[12px] font-medium text-canvas shadow-2"
    >
      {toast.message}
      {toast.link ? (
        <>
          {" "}
          <a
            href={toast.link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="focus-ring font-semibold underline underline-offset-2"
          >
            {toast.link.label}
          </a>
        </>
      ) : null}
    </div>
  ) : null;
