import type { ChatRuntimeAccessMode, RuntimeConfigurationProvider } from "@aop/common";
import {
  CheckIcon,
  ChevronDownIcon,
  LockIcon,
  LockOpenIcon,
  PenLineIcon,
  PlusIcon,
  ZapIcon,
} from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { Separator } from "@/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import { shouldUseCompactComposerFooter } from "./composer-footer-layout";
import { ComposerModelPicker } from "./composer-model-picker";

export interface ComposerFooterPlusMenu {
  onAttachImage?: () => void;
  imageDisabled?: boolean;
  onAttachDocument?: () => void;
  documentDisabled?: boolean;
  onImportSkill?: () => void;
}

interface ComposerFooterProps {
  runtime: string;
  runtimeConfigurationId?: string | null;
  runtimeConfigurations: RuntimeConfigurationProvider[];
  model: string;
  modelLabel: string;
  effort: string;
  effortLabel: string;
  effortOptions: Array<{ value: string; label: string }>;
  accessMode: ChatRuntimeAccessMode;
  showAccessMode: boolean;
  connected: boolean;
  assistantActive: boolean;
  aborting: boolean;
  canSend: boolean;
  supportsFastMode: boolean;
  fastMode: boolean;
  plusMenu?: ComposerFooterPlusMenu;
  /** Workflow chip slot (PLAN §6.4) rendered after the model picker. */
  workflowChip?: React.ReactNode;
  onModelChange?: (model: string, runtimeConfigurationId?: string) => void;
  onEffortChange?: (effort: string) => void;
  onAccessModeChange?: (mode: ChatRuntimeAccessMode) => void;
  onToggleFastMode?: () => void;
  /** Model choice is fixed once the session has its first message. */
  modelLocked?: boolean;
  onSend: () => void;
  onAbort?: () => void;
}

/** Composer footer (PLAN §6.2): ＋ · model chip · effort chip · access chip · Fast chip · send. */
export function ComposerFooter(props: ComposerFooterProps) {
  const footerRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);

  useLayoutEffect(() => {
    const footer = footerRef.current;
    if (!footer) return;
    const updateCompactness = () => {
      const next = shouldUseCompactComposerFooter(footer.clientWidth);
      setCompact((current) => (current === next ? current : next));
    };
    updateCompactness();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateCompactness);
    observer.observe(footer);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={footerRef}
      data-testid="composer-toolbar"
      data-chat-composer-footer="true"
      data-chat-composer-footer-compact={compact ? "true" : "false"}
      className={cn(
        "flex min-w-0 flex-nowrap items-center justify-between overflow-visible px-2.5 pb-2.5 sm:px-3 sm:pb-3",
        compact ? "gap-1.5" : "gap-2 sm:gap-0",
      )}
    >
      <div className="-m-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {props.plusMenu ? <PlusMenu plusMenu={props.plusMenu} /> : null}
        <ComposerModelPicker
          runtime={props.runtime}
          runtimeConfigurationId={props.runtimeConfigurationId}
          runtimeConfigurations={props.runtimeConfigurations}
          model={props.model}
          label={props.modelLabel}
          compact={compact}
          locked={props.modelLocked}
          onModelChange={props.onModelChange}
        />
        {props.workflowChip}
        {compact ? (
          <CompactControlsMenu {...props} />
        ) : (
          <>
            <ComposerSeparator />
            <EffortMenu {...props} />
            {props.showAccessMode ? <AccessModeMenu {...props} /> : null}
            {props.supportsFastMode ? <FastModeToggle {...props} /> : null}
          </>
        )}
      </div>
      <div
        data-testid="composer-toolbar-right"
        data-chat-composer-actions="right"
        className="flex shrink-0 flex-nowrap items-center justify-end gap-2"
      >
        <ComposerPrimaryAction {...props} />
      </div>
    </div>
  );
}

function PlusMenu({ plusMenu }: { plusMenu: ComposerFooterPlusMenu }) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-testid="composer-plus"
              aria-label="Add to message"
              className="grid size-8 shrink-0 place-items-center rounded-full text-text-subtle transition-colors duration-[120ms] hover:bg-hover hover:text-text"
            >
              <PlusIcon aria-hidden="true" className="size-4" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">Add to message</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" side="top">
        <DropdownMenuItem disabled={plusMenu.imageDisabled} onSelect={plusMenu.onAttachImage}>
          Attach image
        </DropdownMenuItem>
        <DropdownMenuItem disabled={plusMenu.documentDisabled} onSelect={plusMenu.onAttachDocument}>
          Attach document
        </DropdownMenuItem>
        {plusMenu.onImportSkill ? (
          <DropdownMenuItem onSelect={plusMenu.onImportSkill}>Import skill</DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function EffortMenu(props: ComposerFooterProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Reasoning effort"
          className="flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2 text-[12.5px] font-medium text-text-muted transition-colors duration-[120ms] hover:bg-hover hover:text-text sm:px-3"
        >
          <span>{props.effortLabel}</span>
          <ChevronDownIcon aria-hidden="true" className="size-3 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top">
        <DropdownMenuLabel>Reasoning effort</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={props.effort}
          onValueChange={(value) => {
            if (value) props.onEffortChange?.(value);
          }}
        >
          {props.effortOptions.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AccessModeMenu(props: ComposerFooterProps) {
  const selected =
    ACCESS_MODE_OPTIONS.find((option) => option.value === props.accessMode) ??
    ACCESS_MODE_OPTIONS[2];
  if (!selected) return null;
  const SelectedIcon = selected.icon;

  return (
    <>
      <ComposerSeparator />
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Runtime mode"
                className="flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-[12.5px] font-medium text-text-muted transition-colors duration-[120ms] hover:bg-hover hover:text-text sm:px-3"
              >
                <SelectedIcon className="size-4" />
                <span>{selected.label}</span>
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="top">{selected.description}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" side="top" className="min-w-64">
          {ACCESS_MODE_OPTIONS.map((option) => {
            const OptionIcon = option.icon;
            const isSelected = props.accessMode === option.value;
            return (
              <DropdownMenuItem
                key={option.value}
                onSelect={() => props.onAccessModeChange?.(option.value)}
                className="py-2"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <span className="inline-flex items-center gap-1.5 font-medium text-text">
                      <OptionIcon className="size-3.5 shrink-0 text-text-subtle" />
                      {option.label}
                    </span>
                    <span className="text-[12px] leading-4 text-text-muted">
                      {option.description}
                    </span>
                  </div>
                  <CheckIcon
                    className={cn("size-4 text-running", isSelected ? "opacity-100" : "opacity-0")}
                  />
                </div>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

function FastModeToggle(props: ComposerFooterProps) {
  const tooltip = props.fastMode ? "Fast mode on" : "Enable fast mode";
  return (
    <>
      <ComposerSeparator />
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            data-testid="composer-fast-mode"
            aria-label={props.fastMode ? "Disable fast mode" : "Enable fast mode"}
            aria-pressed={props.fastMode}
            data-on={props.fastMode ? "" : undefined}
            onClick={props.onToggleFastMode}
            className={cn(
              "flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-[12.5px] font-medium transition-colors duration-[120ms] sm:px-3",
              props.fastMode
                ? "bg-active text-text hover:bg-hover"
                : "text-text-muted hover:bg-hover hover:text-text",
            )}
          >
            <ZapIcon className={props.fastMode ? "size-4 text-favorite" : "size-4"} />
            <span>Fast</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{tooltip}</TooltipContent>
      </Tooltip>
    </>
  );
}

/** Compact widths collapse effort/access/fast into one menu (composerFooterLayout). */
function CompactControlsMenu(props: ComposerFooterProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="composer-compact-controls"
          aria-label="Composer controls"
          className="flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2 text-[12.5px] font-medium text-text-muted transition-colors duration-[120ms] hover:bg-hover hover:text-text"
        >
          <span>{props.effortLabel}</span>
          <ChevronDownIcon aria-hidden="true" className="size-3 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top">
        <DropdownMenuLabel>Reasoning effort</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={props.effort}
          onValueChange={(value) => {
            if (value) props.onEffortChange?.(value);
          }}
        >
          {props.effortOptions.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {props.showAccessMode ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Runtime mode</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={props.accessMode}
              onValueChange={(value) => {
                if (isRuntimeAccessMode(value)) props.onAccessModeChange?.(value);
              }}
            >
              {ACCESS_MODE_OPTIONS.map((option) => (
                <DropdownMenuRadioItem key={option.value} value={option.value}>
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        ) : null}
        {props.supportsFastMode ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={props.onToggleFastMode}>
              <ZapIcon className={props.fastMode ? "text-favorite" : undefined} />
              {props.fastMode ? "Disable fast mode" : "Enable fast mode"}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const ACCESS_MODE_OPTIONS: Array<{
  value: ChatRuntimeAccessMode;
  label: string;
  description: string;
  icon: typeof LockIcon;
}> = [
  {
    value: "approval-required",
    label: "Supervised",
    description: "Ask before commands and file changes.",
    icon: LockIcon,
  },
  {
    value: "auto-accept-edits",
    label: "Auto-accept edits",
    description: "Auto-approve edits, ask before other actions.",
    icon: PenLineIcon,
  },
  {
    value: "full-access",
    label: "Full access",
    description: "Allow commands and edits without prompts.",
    icon: LockOpenIcon,
  },
];

const isRuntimeAccessMode = (value: string): value is ChatRuntimeAccessMode =>
  ACCESS_MODE_OPTIONS.some((option) => option.value === value);

function ComposerSeparator() {
  return <Separator orientation="vertical" className="mx-0.5 hidden h-4 sm:block" />;
}

/** Send = white circle / Stop = red (PLAN §4.1). */
function ComposerPrimaryAction(props: ComposerFooterProps) {
  if (props.assistantActive) {
    return (
      <button
        type="button"
        data-testid="composer-conversation-action"
        className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-blocked/90 text-white transition-all duration-150 hover:scale-105 hover:bg-blocked disabled:pointer-events-none disabled:opacity-30 sm:h-8 sm:w-8"
        onClick={props.onAbort}
        disabled={props.aborting || !props.onAbort}
        aria-label="Stop conversation"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
          <rect x="2" y="2" width="8" height="8" rx="1.5" />
        </svg>
      </button>
    );
  }

  return (
    <button
      type="button"
      data-testid="composer-conversation-action"
      className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/90 text-primary-foreground transition-all duration-150 enabled:cursor-pointer enabled:hover:scale-105 hover:bg-primary disabled:pointer-events-none disabled:opacity-30 disabled:hover:scale-100 sm:h-8 sm:w-8"
      disabled={!props.connected || !props.canSend}
      onClick={props.onSend}
      aria-label={props.connected ? "Send message" : "Environment disconnected"}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path
          d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
