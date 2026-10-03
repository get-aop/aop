import type {
  ComputerUse,
  Project,
  ProjectPatch,
  ProjectSettings,
  ProjectStatus,
  ReportedRuntime,
  RuntimePreferenceInput,
} from "@aop/common";
import { BUILT_IN_RUNTIME_ID } from "@aop/common";
import type { Kysely } from "kysely";
import type { ProjectRow } from "../db/projects-schema.ts";
import type { Database } from "../db/schema.ts";

/**
 * A role that names no runtime is stored on the built-in one, as the v25 column default has it;
 * the service names one before it gets here (see runtime-choice.ts).
 */
export type NewProject = ProjectSettings & { id: string };

export type ProjectRole = "coordinator" | "thread";

export interface ProjectRepository {
  /** A new project is `active`. */
  create: (project: NewProject) => Promise<Project>;
  getById: (id: string) => Promise<Project | null>;
  /** Oldest first. */
  list: () => Promise<Project[]>;
  /**
   * Applies only the settings present in the patch; `repoIds`, when present, replaces the list.
   * A role sent without a runtime keeps the one it has. A role moved to another runtime forgets
   * what its last run reported: that was the old runtime's default, which the new one may not have.
   */
  update: (id: string, patch: ProjectPatch) => Promise<Project | null>;
  setStatus: (id: string, status: ProjectStatus) => Promise<Project | null>;
  /** Not one of the settings a patch carries: only the host owner changes it (project/service.ts). */
  setComputerUse: (id: string, computerUse: ComputerUse) => Promise<Project | null>;
  /**
   * Stores what a role's last run reported; a field left out keeps what was there. Not a
   * setting, so `updatedAt` stays. Null when there is no such project.
   */
  recordReportedRuntime: (
    id: string,
    role: ProjectRole,
    reported: Partial<ReportedRuntime>,
  ) => Promise<Project | null>;
  /**
   * Fails on a foreign key while any session still belongs to the project: threads own
   * worktrees and processes, so they are deleted first (see the v2 migration).
   */
  remove: (id: string) => Promise<boolean>;
}

export const createProjectRepository = (
  db: Kysely<Database>,
  now: () => Date = () => new Date(),
): ProjectRepository => ({
  create: (input) =>
    atomically<Project>(db, async (trx) => {
      const project = withRuntimes(input);
      const at = now().toISOString();
      await trx
        .insertInto("projects")
        .values({
          id: project.id,
          ...toColumns(project),
          status: "active",
          created_at: at,
          updated_at: at,
        })
        .execute();
      await replaceRepos(trx, project.id, project.repoIds);
      return {
        ...project,
        status: "active",
        computerUse: "model-default",
        reportedRuntime: { coordinator: NOTHING_REPORTED, thread: NOTHING_REPORTED },
        createdAt: at,
        updatedAt: at,
      };
    }),

  getById: (id) => getProject(db, id),

  list: async () => {
    const [rows, links] = await Promise.all([
      db.selectFrom("projects").selectAll().orderBy("created_at").orderBy("id").execute(),
      db
        .selectFrom("project_repos")
        .select(["project_id", "repo_id"])
        .orderBy("position")
        .execute(),
    ]);
    return rows.map((row) =>
      toProject(
        row,
        links.filter((link) => link.project_id === row.id).map((link) => link.repo_id),
      ),
    );
  },

  update: (id, patch) =>
    atomically<Project | null>(db, async (trx) => {
      const current = await getProject(trx, id);
      if (!current) return null;
      const next = applyPatch(current, patch);
      const updatedAt = now().toISOString();
      const reportedRuntime = forgetMovedRoles(current, next);
      await trx
        .updateTable("projects")
        .set({ ...toColumns(next), ...reportedColumns(reportedRuntime), updated_at: updatedAt })
        .where("id", "=", id)
        .execute();
      if (patch.repoIds) await replaceRepos(trx, id, patch.repoIds);
      return { ...current, ...next, reportedRuntime, updatedAt };
    }),

  setStatus: (id, status) =>
    atomically<Project | null>(db, async (trx) => {
      const current = await getProject(trx, id);
      if (!current) return null;
      const updatedAt = now().toISOString();
      await trx
        .updateTable("projects")
        .set({ status, updated_at: updatedAt })
        .where("id", "=", id)
        .execute();
      return { ...current, status, updatedAt };
    }),

  setComputerUse: (id, computerUse) =>
    atomically<Project | null>(db, async (trx) => {
      const current = await getProject(trx, id);
      if (!current) return null;
      const updatedAt = now().toISOString();
      await trx
        .updateTable("projects")
        .set({ computer_use: computerUse, updated_at: updatedAt })
        .where("id", "=", id)
        .execute();
      return { ...current, computerUse, updatedAt };
    }),

  recordReportedRuntime: async (id, role, reported) => {
    // Kysely leaves a column whose value is undefined out of the update.
    const columns =
      role === "coordinator"
        ? {
            coordinator_reported_model: reported.model,
            coordinator_reported_effort: reported.effort,
          }
        : { thread_reported_model: reported.model, thread_reported_effort: reported.effort };
    if (reported.model !== undefined || reported.effort !== undefined) {
      await db.updateTable("projects").set(columns).where("id", "=", id).execute();
    }
    return getProject(db, id);
  },

  remove: async (id) => {
    // The dialect reports no affected-row count, so existence is read first.
    const existing = await db
      .selectFrom("projects")
      .select("id")
      .where("id", "=", id)
      .executeTakeFirst();
    if (!existing) return false;
    await db.deleteFrom("projects").where("id", "=", id).execute();
    return true;
  },
});

// Multi-statement writes join the caller's transaction when there is one, so a service can
// commit a project change together with its event_log entry.
const atomically = <T>(
  db: Kysely<Database>,
  run: (trx: Kysely<Database>) => Promise<T>,
): Promise<T> => (db.isTransaction ? run(db) : db.transaction().execute(run));

const NOTHING_REPORTED: ReportedRuntime = { model: null, effort: null };

// Only a field left out keeps its value: null is a value of its own (an icon or colour cleared
// back to the letter tile), so it replaces what was there.
const applyPatch = (current: Project, patch: ProjectPatch): StoredSettings => {
  const next = {
    ...current,
    ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
  };
  return {
    ...next,
    coordinator: keepRuntime(current.coordinator, patch.coordinator),
    thread: keepRuntime(current.thread, patch.thread),
  };
};

type StoredSettings = Omit<ProjectSettings, "coordinator" | "thread"> &
  Pick<Project, "coordinator" | "thread">;

const withRuntimes = <T extends ProjectSettings>(
  settings: T,
): Omit<T, "coordinator" | "thread"> & Pick<Project, "coordinator" | "thread"> => ({
  ...settings,
  coordinator: {
    ...settings.coordinator,
    runtimeId: settings.coordinator.runtimeId ?? BUILT_IN_RUNTIME_ID,
  },
  thread: { ...settings.thread, runtimeId: settings.thread.runtimeId ?? BUILT_IN_RUNTIME_ID },
});

const keepRuntime = (
  current: Project["coordinator"],
  sent: RuntimePreferenceInput | undefined,
): Project["coordinator"] =>
  sent ? { ...sent, runtimeId: sent.runtimeId ?? current.runtimeId } : current;

const forgetMovedRoles = (current: Project, next: StoredSettings): Project["reportedRuntime"] => ({
  coordinator:
    current.coordinator.runtimeId === next.coordinator.runtimeId
      ? current.reportedRuntime.coordinator
      : NOTHING_REPORTED,
  thread:
    current.thread.runtimeId === next.thread.runtimeId
      ? current.reportedRuntime.thread
      : NOTHING_REPORTED,
});

const reportedColumns = ({ coordinator, thread }: Project["reportedRuntime"]) => ({
  coordinator_reported_model: coordinator.model,
  coordinator_reported_effort: coordinator.effort,
  thread_reported_model: thread.model,
  thread_reported_effort: thread.effort,
});

const toColumns = (settings: StoredSettings) => ({
  name: settings.name,
  icon: settings.icon,
  color: settings.color,
  goal: settings.goal,
  instructions: settings.instructions,
  coordinator_provider: settings.coordinator.provider,
  coordinator_runtime_id: settings.coordinator.runtimeId,
  coordinator_model: settings.coordinator.model,
  coordinator_effort: settings.coordinator.effort,
  thread_provider: settings.thread.provider,
  thread_runtime_id: settings.thread.runtimeId,
  thread_model: settings.thread.model,
  thread_effort: settings.thread.effort,
  notification_level: settings.notificationLevel,
  thread_access: settings.threadAccess,
  auto_fix_pull_requests: settings.autoFixPullRequests ? (1 as const) : (0 as const),
  auto_continue: settings.autoContinue ? (1 as const) : (0 as const),
});

const replaceRepos = async (
  trx: Kysely<Database>,
  projectId: string,
  repoIds: readonly string[],
): Promise<void> => {
  await trx.deleteFrom("project_repos").where("project_id", "=", projectId).execute();
  if (repoIds.length === 0) return;
  await trx
    .insertInto("project_repos")
    .values(
      repoIds.map((repoId, position) => ({ project_id: projectId, repo_id: repoId, position })),
    )
    .execute();
};

const getProject = async (db: Kysely<Database>, id: string): Promise<Project | null> => {
  const row = await db.selectFrom("projects").selectAll().where("id", "=", id).executeTakeFirst();
  if (!row) return null;
  const links = await db
    .selectFrom("project_repos")
    .select("repo_id")
    .where("project_id", "=", id)
    .orderBy("position")
    .execute();
  return toProject(
    row,
    links.map((link) => link.repo_id),
  );
};

const toProject = (row: ProjectRow, repoIds: string[]): Project => ({
  id: row.id,
  name: row.name,
  icon: row.icon,
  color: row.color,
  goal: row.goal,
  instructions: row.instructions,
  coordinator: {
    provider: row.coordinator_provider,
    runtimeId: row.coordinator_runtime_id,
    model: row.coordinator_model,
    effort: row.coordinator_effort,
  },
  thread: {
    provider: row.thread_provider,
    runtimeId: row.thread_runtime_id,
    model: row.thread_model,
    effort: row.thread_effort,
  },
  notificationLevel: row.notification_level,
  threadAccess: row.thread_access,
  autoFixPullRequests: row.auto_fix_pull_requests === 1,
  autoContinue: row.auto_continue === 1,
  computerUse: row.computer_use,
  repoIds,
  status: row.status,
  reportedRuntime: {
    coordinator: { model: row.coordinator_reported_model, effort: row.coordinator_reported_effort },
    thread: { model: row.thread_reported_model, effort: row.thread_reported_effort },
  },
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
