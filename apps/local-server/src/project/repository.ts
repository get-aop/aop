import type {
  Project,
  ProjectPatch,
  ProjectSettings,
  ProjectStatus,
  ReportedRuntime,
} from "@aop/common";
import type { Kysely } from "kysely";
import type { ProjectRow } from "../db/projects-schema.ts";
import type { Database } from "../db/schema.ts";

export type NewProject = ProjectSettings & { id: string };

export type ProjectRole = "coordinator" | "thread";

export interface ProjectRepository {
  /** A new project is `active`. */
  create: (project: NewProject) => Promise<Project>;
  getById: (id: string) => Promise<Project | null>;
  /** Oldest first. */
  list: () => Promise<Project[]>;
  /** Applies only the settings present in the patch; `repoIds`, when present, replaces the list. */
  update: (id: string, patch: ProjectPatch) => Promise<Project | null>;
  setStatus: (id: string, status: ProjectStatus) => Promise<Project | null>;
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
  create: (project) =>
    atomically<Project>(db, async (trx) => {
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
      await trx
        .updateTable("projects")
        .set({ ...toColumns(next), updated_at: updatedAt })
        .where("id", "=", id)
        .execute();
      if (patch.repoIds) await replaceRepos(trx, id, patch.repoIds);
      return { ...current, ...next, updatedAt };
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

const applyPatch = (current: ProjectSettings, patch: ProjectPatch): ProjectSettings => ({
  name: patch.name ?? current.name,
  goal: patch.goal ?? current.goal,
  instructions: patch.instructions ?? current.instructions,
  coordinator: patch.coordinator ?? current.coordinator,
  thread: patch.thread ?? current.thread,
  notificationLevel: patch.notificationLevel ?? current.notificationLevel,
  threadAccess: patch.threadAccess ?? current.threadAccess,
  autoFixPullRequests: patch.autoFixPullRequests ?? current.autoFixPullRequests,
  autoContinue: patch.autoContinue ?? current.autoContinue,
  repoIds: patch.repoIds ?? current.repoIds,
});

const toColumns = (settings: ProjectSettings) => ({
  name: settings.name,
  goal: settings.goal,
  instructions: settings.instructions,
  coordinator_provider: settings.coordinator.provider,
  coordinator_model: settings.coordinator.model,
  coordinator_effort: settings.coordinator.effort,
  thread_provider: settings.thread.provider,
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
  goal: row.goal,
  instructions: row.instructions,
  coordinator: {
    provider: row.coordinator_provider,
    model: row.coordinator_model,
    effort: row.coordinator_effort,
  },
  thread: {
    provider: row.thread_provider,
    model: row.thread_model,
    effort: row.thread_effort,
  },
  notificationLevel: row.notification_level,
  threadAccess: row.thread_access,
  autoFixPullRequests: row.auto_fix_pull_requests === 1,
  autoContinue: row.auto_continue === 1,
  repoIds,
  status: row.status,
  reportedRuntime: {
    coordinator: { model: row.coordinator_reported_model, effort: row.coordinator_reported_effort },
    thread: { model: row.thread_reported_model, effort: row.thread_reported_effort },
  },
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
