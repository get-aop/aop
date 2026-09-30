import { describeFirstIssue, ProjectSettingsSchema } from "@aop/common";

const NameOnly = ProjectSettingsSchema.pick({ name: true });

/** The words a person knows a project setting by, where they are not the setting's key made into words. */
export const PROJECT_FIELD_LABELS = { repoIds: "Repositories" };

/**
 * Why a typed project name cannot be used, as a sentence for the name field, or null. A blank
 * name is not a mistake yet (each form waits for one its own way), so it has no problem here.
 */
export const projectNameProblem = (name: string): string | null => {
  if (name.trim() === "") return null;
  const parsed = NameOnly.safeParse({ name });
  return parsed.success ? null : describeFirstIssue(parsed.error.issues, "Check the name");
};
