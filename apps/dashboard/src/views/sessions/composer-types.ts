import type {
  ChatDocumentAttachment,
  ChatRuntimeAccessMode,
  RuntimeConfigurationProvider,
} from "@aop/common";
import type { ReactNode } from "react";
import type { LocalCreateTaskImage } from "../../components/create-task-images";
import type { ComposerPasteEntry } from "./composer-paste-collapse";
import type { SessionReviewComment } from "./session-review-queue";

export interface ChatComposerProps {
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
  /** Active session runtime configuration id (selects the model/effort options). */
  sessionRuntimeConfigurationId?: string | null;
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
  /** Model choice is fixed once the session has its first message. */
  modelLocked?: boolean;
  runtimeAccessMode?: ChatRuntimeAccessMode;
  onRuntimeAccessModeChange?: (mode: ChatRuntimeAccessMode) => void;
  onMoreMenu?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onSlashPick: (cmd: string) => void;
  repos?: Array<{ id: string; name: string | null; path: string }>;
  /** Merged-PR bar rendered above the input inside the composer surface. */
  mergedPrBar?: ReactNode;
}
