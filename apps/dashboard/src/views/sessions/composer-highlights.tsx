import { CONTROL_COMMANDS } from "@aop/common";
import type { CSSProperties, RefObject } from "react";
import { useLayoutEffect, useRef } from "react";

export type MentionTokenKind = "worker" | "workflow" | "repo" | "control" | "paste";

export interface MentionToken {
  kind: MentionTokenKind;
  start: number;
  end: number;
  id: string;
  label: string;
}

interface MentionSources {
  workers: Array<{ id: string; name: string }>;
  workflows: string[];
  repos: Array<{ id: string; name: string | null; path: string }>;
}

export const parseMentionTokens = (draft: string, sources: MentionSources): MentionToken[] => {
  const tokens: MentionToken[] = [];
  const sigils = /(^|\s)([%#~$])/g;
  for (const match of draft.matchAll(sigils)) {
    const sigil = match[2];
    if (!sigil || match.index === undefined) continue;
    const start = match.index + (match[1]?.length ?? 0);
    const candidate = mentionCandidates(sigil, sources).find(({ label }) =>
      matchesKnownLabel(draft, start + 1, label),
    );
    if (!candidate) continue;
    tokens.push({ ...candidate, start, end: start + 1 + candidate.label.length });
  }
  return tokens;
};

export const ComposerHighlightLayer = ({
  input,
  tokens,
  textareaRef,
}: {
  input: string;
  tokens: MentionToken[];
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) => {
  const layerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    const layer = layerRef.current;
    if (!textarea || !layer) return;

    const syncMetrics = () => {
      // Shared CSS handles font metrics; only keep the boxes size/scroll locked.
      layer.style.height = `${textarea.offsetHeight}px`;
      layer.scrollTop = textarea.scrollTop;
      layer.scrollLeft = textarea.scrollLeft;
    };

    const onScroll = () => {
      layer.scrollTop = textarea.scrollTop;
      layer.scrollLeft = textarea.scrollLeft;
    };

    syncMetrics();
    textarea.addEventListener("scroll", onScroll);
    if (typeof ResizeObserver === "undefined") {
      return () => textarea.removeEventListener("scroll", onScroll);
    }
    const observer = new ResizeObserver(syncMetrics);
    observer.observe(textarea);
    return () => {
      textarea.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, [textareaRef]);

  return (
    <div
      ref={layerRef}
      data-testid="composer-highlight-layer"
      aria-hidden="true"
      className="composer-highlight-layer composer-text-surface chat-text-surface"
    >
      {renderHighlightedInput(input, tokens)}
    </div>
  );
};

const mentionCandidates = (sigil: string, sources: MentionSources) => {
  const candidates =
    sigil === "%"
      ? sources.workers.map((worker) => ({
          kind: "worker" as const,
          id: worker.id,
          label: worker.name,
        }))
      : sigil === "#"
        ? sources.workflows.map((workflow) => ({
            kind: "workflow" as const,
            id: workflow,
            label: workflow,
          }))
        : sigil === "~"
          ? sources.repos.map((repo) => ({
              kind: "repo" as const,
              id: repo.id,
              label: repo.name ?? repo.id,
            }))
          : CONTROL_COMMANDS.map((command) => ({
              kind: "control" as const,
              id: command.id,
              label: command.id,
            }));
  return candidates.toSorted((a, b) => b.label.length - a.label.length);
};

const matchesKnownLabel = (draft: string, labelStart: number, label: string): boolean => {
  const matched = draft.slice(labelStart, labelStart + label.length);
  if (matched.toLowerCase() !== label.toLowerCase()) return false;
  const next = draft[labelStart + label.length];
  return next === undefined || /\s|[.,!?;:)]/.test(next);
};

const renderHighlightedInput = (input: string, tokens: MentionToken[]) => {
  const fragments = [];
  let cursor = 0;
  // Keep non-overlapping order so mixed mention + delegation marks paint cleanly.
  const ordered = [...tokens].toSorted((a, b) => a.start - b.start);
  for (const token of ordered) {
    if (token.start < cursor) continue;
    if (token.start > cursor) fragments.push(input.slice(cursor, token.start));
    fragments.push(
      <mark
        key={`${token.kind}-${token.start}`}
        data-kind={token.kind}
        style={markStyleForKind(token.kind)}
      >
        {input.slice(token.start, token.end)}
      </mark>,
    );
    cursor = token.end;
  }
  if (cursor < input.length) fragments.push(input.slice(cursor));
  return fragments;
};

const markStyleForKind = (kind: MentionTokenKind): CSSProperties => {
  if (kind === "control") return CONTROL_MARK_STYLE;
  if (kind === "paste") return PASTE_MARK_STYLE;
  return MENTION_MARK_STYLE;
};

const MENTION_MARK_STYLE: CSSProperties = {
  background: "var(--mention-bg)",
  color: "var(--mention-fg)",
  borderRadius: 4,
  padding: 0,
  // Keep marks from introducing box metrics that shift glyph advances.
  margin: 0,
  border: 0,
  font: "inherit",
  letterSpacing: "inherit",
  lineHeight: "inherit",
};

const CONTROL_MARK_STYLE: CSSProperties = {
  ...MENTION_MARK_STYLE,
  background: "var(--mention-control-bg)",
  color: "var(--mention-control-fg)",
};

const PASTE_MARK_STYLE: CSSProperties = {
  ...MENTION_MARK_STYLE,
  background: "color-mix(in srgb, var(--color-text-subtle) 18%, transparent)",
  color: "var(--color-text-subtle)",
};
