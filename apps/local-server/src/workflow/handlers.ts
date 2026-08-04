import type { StepBlockDefinition } from "../workflow-engine/step-library.ts";
import type {
  CreateSkillBlockInput,
  CreateWorkflowInput,
  LocalWorkflowService,
  WorkflowSummary,
} from "./service.ts";

export interface WorkflowListResult {
  workflows: string[];
}

export interface WorkflowDetailsResult {
  workflows: WorkflowSummary[];
}

export interface StepLibraryResult {
  steps: StepBlockDefinition[];
}

export interface WorkflowSaveResult {
  workflow: WorkflowSummary;
}

export interface SkillBlockSaveResult {
  step: StepBlockDefinition;
}

export const listWorkflows = async (
  workflowService: LocalWorkflowService,
): Promise<WorkflowListResult> => {
  return { workflows: await workflowService.listWorkflows() };
};

export const listWorkflowDetails = async (
  workflowService: LocalWorkflowService,
): Promise<WorkflowDetailsResult> => {
  return { workflows: await workflowService.listWorkflowDetails() };
};

export const listStepLibrary = async (
  workflowService: LocalWorkflowService,
): Promise<StepLibraryResult> => {
  return { steps: await workflowService.listStepLibrary() };
};

export const createWorkflowFromSteps = async (
  workflowService: LocalWorkflowService,
  input: CreateWorkflowInput,
): Promise<WorkflowSaveResult> => {
  return { workflow: await workflowService.createWorkflowFromSteps(input) };
};

export const createSkillBlock = async (
  workflowService: LocalWorkflowService,
  input: CreateSkillBlockInput,
): Promise<SkillBlockSaveResult> => {
  return { step: await workflowService.createSkillBlock(input) };
};

export const deleteSkillBlock = async (
  workflowService: LocalWorkflowService,
  id: string,
): Promise<void> => {
  await workflowService.deleteSkillBlock(id);
};

export const deleteWorkflow = async (
  workflowService: LocalWorkflowService,
  id: string,
): Promise<void> => {
  await workflowService.deleteWorkflow(id);
};
