import type {
  ChatDocumentAttachment,
  ChatRuntimeAccessMode,
  ChatRuntimeActionSelection,
  ChatWorkflowSelection,
  ControlCommandSelection,
  RuntimeConfigurationProvider,
  RuntimeDelegationSelection,
  SessionGitBranchList,
  TerminalLine,
} from "@aop/common";
import type { ReactNode } from "react";
import type { LocalCreateTaskImage } from "../../components/create-task-images";
import type { ComposerPasteEntry } from "./composer-paste-collapse";
import type { SessionReviewComment } from "./session-review-queue";
import type { WorkflowTypeaheadOption } from "./typeahead";

export interface WorkflowRunViewState {
  runId: string;
  workflowName: string;
  stepCount: number;
  currentIndex: number;
  currentStepId: string;
  currentStepType: string;
}

export interface ChatComposerProps {
  /** Active chat session — used to match the thread's delegation-rail offset. */
  sessionId?: string | null;
  input: string;
  onInput: (value: string) => void;
  /** Large pastes collapsed out of the textarea into `[paste #N +lines]` tokens. */
  pastes?: ComposerPasteEntry[];
  onPastesChange?: (pastes: ComposerPasteEntry[]) => void;
  onSend: () => void;
  /** Queued diff review comments drained into the next send. */
  reviewComments?: SessionReviewComment[];
  onUpdateReviewComment?: (id: string, note: string) => void;
  onRemoveReviewComment?: (id: string) => void;
  runtimeConfigurations?: RuntimeConfigurationProvider[];
  /** Active session runtime configuration id (for $ control multi-profile inheritance). */
  sessionRuntimeConfigurationId?: string | null;
  runtimeDelegation?: RuntimeDelegationSelection | null;
  onRuntimeDelegationChange?: (delegation: RuntimeDelegationSelection | null) => void;
  controlSelection?: ControlCommandSelection | null;
  onControlSelectionChange?: (selection: ControlCommandSelection | null) => void;
  runtimeActions?: ChatRuntimeActionSelection[];
  onRuntimeActionsChange?: (actions: ChatRuntimeActionSelection[]) => void;
  workflowSelection?: ChatWorkflowSelection | null;
  onWorkflowSelectionChange?: (selection: ChatWorkflowSelection | null) => void;
  /** Armed: the next message runs through the selected workflow. */
  workflowArmed?: boolean;
  onWorkflowArmedChange?: (armed: boolean) => void;
  /** Active chat workflow run: locks the composer and shows step progress. */
  workflowRun?: WorkflowRunViewState | null;
  assistantActive?: boolean;
  aborting?: boolean;
  onAbort?: () => void;
  /** User messages waiting while the assistant is active. */
  queueCount?: number;
  runtime: string;
  runtimeConfigurationName?: string | null;
  model: string;
  effort: string;
  /** Session fast mode on/off (only when model supports it). */
  fastMode?: boolean;
  /** Whether the selected model exposes a Fast option. */
  supportsFastMode?: boolean;
  onToggleFastMode?: () => void;
  alias?: string | null;
  connected: boolean;
  termOpen: boolean;
  onToggleTerm?: () => void;
  images?: LocalCreateTaskImage[];
  documents?: ChatDocumentAttachment[];
  onAttachImages?: (files: FileList | File[] | null) => void;
  onPasteImages?: (items: DataTransferItemList) => void;
  onRemoveImage?: (id: string) => void;
  onRemoveDocument?: (id: string) => void;
  attachDisabled?: boolean;
  onRuntimeConfigMenu?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  /** The ＋ menu (Attach image · Attach document · Import skill). */
  plusMenu?: import("./composer-footer").ComposerFooterPlusMenu;
  onRuntimeMenu?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onModelMenu?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onEffortMenu?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onModelChange?: (model: string, runtimeConfigurationId?: string) => void;
  onEffortChange?: (effort: string) => void;
  runtimeAccessMode?: ChatRuntimeAccessMode;
  onRuntimeAccessModeChange?: (mode: ChatRuntimeAccessMode) => void;
  onMoreMenu?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onSlashPick: (cmd: string) => void;
  workers?: Array<{ id: string; name: string }>;
  workflows?: Array<string | WorkflowTypeaheadOption>;
  repos?: Array<{ id: string; name: string | null; path: string }>;
  defaultWorkerId?: string | null;
  defaultWorkflowId?: string | null;
  onDefaultWorkerChange?: (workerId: string | null) => void;
  onDefaultWorkflowChange?: (workflowId: string | null) => void;
  termLines: TerminalLine[];
  termInput: string;
  onTermInput: (value: string) => void;
  onTermRun: () => void;
  onTermClose: () => void;
  repoPath: string;
  worktreePath?: string | null;
  branch?: string | null;
  onListBranches?: () => Promise<SessionGitBranchList>;
  onBranchChange?: (branch: string) => Promise<void> | void;
  /** Diffstat for the session git bar; chip only when filesChanged > 0. */
  gitDiffstat?: { filesChanged: number; additions: number; deletions: number } | null;
  onDiffstatClick?: () => void;
  /** Opens the right panel at the Tasks tab (git row chip). */
  onOpenTasks?: () => void;
  tasksCount?: number;
  /** Create-PR/checks/merge controls rendered on the right of the git bar. */
  gitPrControls?: ReactNode;
  /** Merged-PR bar rendered above the git bar inside the composer surface. */
  mergedPrBar?: ReactNode;
  /** Suggested worktree branch name for the create popover. */
  suggestedWorktreeBranch?: string | null;
  onCreateWorktree?: (branchName: string) => Promise<void> | void;
  onCommit?: (mode: "commit" | "commit-and-push") => Promise<void>;
  onToast?: (message: string) => void;
}
