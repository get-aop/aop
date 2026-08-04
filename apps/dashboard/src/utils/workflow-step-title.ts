import { humanizeTaskTitle } from "./humanize-task-title";

const BUILT_IN_STEP_TITLES: Record<string, string> = {
  review: "Code Review",
  code_review: "Alternative Code Review",
};

export const workflowStepTitle = (stepId: string): string =>
  BUILT_IN_STEP_TITLES[stepId] ?? humanizeTaskTitle(stepId);
