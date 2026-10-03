import { Database as BunDatabase } from "bun:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { aopPaths } from "@aop/infra";
import { type Generated, Kysely } from "kysely";
// The ESM build, for the reason given in db/connection.ts.
import { BunSqliteDialect } from "kysely-bun-sqlite/dist/index.js";
import { INBOX_V1_STATEMENTS } from "./inbox-v1.ts";
import { INBOX_V2_STATEMENTS } from "./inbox-v2.ts";

/**
 * The Inbox keeps its messages in a database of its own, `$AOP_HOME/inbox/inbox.db`, in a
 * directory only the host's user can open. Slack text never enters the main database, which
 * backups and support bundles copy, and the person can wipe it without touching anything else.
 */
export const inboxDbPath = (): string => join(aopPaths.home(), "inbox", "inbox.db");

interface InboxMigration {
  version: number;
  name: string;
  statements: readonly string[];
}

/** Append-only, like the main database's MIGRATIONS: add a version, never change one. */
export const INBOX_MIGRATIONS: readonly InboxMigration[] = [
  { version: 1, name: "inbox", statements: INBOX_V1_STATEMENTS },
  { version: 2, name: "slack", statements: INBOX_V2_STATEMENTS },
];

export interface InboxItemsTable {
  id: string;
  source_id: string;
  /** Gathers a DM conversation's or a thread's messages into one item (see service.ts). */
  item_key: string;
  conversation_id: string;
  conversation_name: string;
  conversation_kind: string;
  thread_id: string | null;
  /** The latest matching message: edits and deletes at the source find the item by it. */
  message_id: string;
  author_id: string;
  author_name: string;
  author_avatar_url: string | null;
  text: string;
  reason: string;
  message_count: Generated<number>;
  state: Generated<string>;
  snoozed_until: string | null;
  permalink: string | null;
  deleted: Generated<number>;
  expired: Generated<number>;
  received_at: string;
  created_at: string;
  updated_at: string;
}

export interface InboxLinksTable {
  id: string;
  item_id: string;
  kind: string;
  ref: string;
  project_id: string | null;
  title: string | null;
  url: string | null;
  post_back: Generated<number>;
  /** How far the host followed a thread link's pull request: null, `opened`, `merged`, `closed`. */
  pr_noted: string | null;
  created_at: string;
}

export interface InboxSourcesTable {
  source_id: string;
  /** The person's InboxRules as JSON; null until they change the defaults. */
  rules: string | null;
  notifications: Generated<string>;
  /** The newest message the feed saw (Slack: its `ts`); catch-up reads start there. */
  last_seen: string | null;
  updated_at: string;
}

export interface InboxSentTable {
  source_id: string;
  conversation_id: string;
  message_id: string;
  item_id: string | null;
  sent_at: string;
}

export interface InboxThreadsTable {
  source_id: string;
  conversation_id: string;
  thread_id: string;
  /** Last activity seen in the thread; retention forgets threads quiet for longer than it. */
  touched_at: string;
}

export interface InboxMigrationsTable {
  version: number;
  name: string;
  applied_at: Generated<string>;
}

export interface InboxDatabase {
  inbox_items: InboxItemsTable;
  inbox_links: InboxLinksTable;
  inbox_threads: InboxThreadsTable;
  inbox_sources: InboxSourcesTable;
  inbox_sent: InboxSentTable;
  schema_migrations: InboxMigrationsTable;
}

/**
 * Opens (creating when missing) and migrates the Inbox database. Synchronous, since bun:sqlite
 * is, so the host's app can open it where it builds its routes. `:memory:` gives tests their own.
 */
export const openInboxDatabase = (path: string = inboxDbPath()): Kysely<InboxDatabase> => {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    chmodSync(dirname(path), 0o700);
  }
  const sqlite = new BunDatabase(path, { create: true });
  sqlite.run("PRAGMA foreign_keys = ON");
  sqlite.run("PRAGMA journal_mode = WAL");
  sqlite.run("PRAGMA busy_timeout = 5000");
  sqlite.run("PRAGMA synchronous = NORMAL");
  migrate(sqlite, INBOX_MIGRATIONS);
  if (path !== ":memory:") chmodSync(path, 0o600);
  return new Kysely<InboxDatabase>({ dialect: new BunSqliteDialect({ database: sqlite }) });
};

/** Each version runs once, in one transaction; a database from a newer build is refused. */
export const migrate = (sqlite: BunDatabase, migrations: readonly InboxMigration[]): void => {
  sqlite.run(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const applied = new Set(
    sqlite
      .query<{ version: number }, []>("SELECT version FROM schema_migrations")
      .all()
      .map((row) => row.version),
  );
  const newest = Math.max(0, ...applied);
  const known = migrations[migrations.length - 1]?.version ?? 0;
  if (newest > known) {
    throw new Error(
      `Inbox database version ${newest} is newer than this build supports (${known}). Upgrade AOP.`,
    );
  }
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    sqlite.transaction(() => {
      for (const statement of migration.statements) sqlite.run(statement);
      sqlite.run("INSERT INTO schema_migrations (version, name) VALUES (?, ?)", [
        migration.version,
        migration.name,
      ]);
    })();
  }
};
