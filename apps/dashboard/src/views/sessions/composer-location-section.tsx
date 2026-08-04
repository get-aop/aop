import { SessionLocationStrip } from "./composer-shell";
import type { ChatComposerProps } from "./composer-types";

/** Session/worktree context and GitHub state rendered above the draft editor. */
export const ComposerLocationSection = ({ props }: { props: ChatComposerProps }) => (
  <>
    {props.mergedPrBar ?? null}
    <SessionLocationStrip
      worktreePath={props.worktreePath ?? null}
      branch={props.branch ?? null}
      gitDiffstat={props.gitDiffstat ?? null}
      onDiffstatClick={props.onDiffstatClick}
      gitPrControls={props.gitPrControls ?? null}
      workers={props.workers ?? []}
      defaultWorkerId={props.defaultWorkerId ?? null}
      defaultWorkflowId={props.defaultWorkflowId ?? null}
      onDefaultWorkerChange={props.onDefaultWorkerChange}
      onDefaultWorkflowChange={props.onDefaultWorkflowChange}
      onToast={props.onToast}
    />
  </>
);
