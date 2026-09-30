/**
 * Migration v8: what removing SSH execution hosts leaves behind. Versions 1 to 7 are never
 * edited; a database that applied them only runs these statements.
 *
 * - runtime_profiles.exec_host_id: the host a runtime profile ran on. Threads run on the host
 *   only, so nothing reads or writes it any more. A profile that was bound to an SSH host
 *   simply runs locally after this.
 * - settings `remote_exec_hosts_json`: the list of SSH hosts. Its key is gone from the code,
 *   which ignores a stored row it does not know, so the row would sit unread forever.
 */
export const EXEC_HOSTS_V8_STATEMENTS: readonly string[] = [
  `ALTER TABLE runtime_profiles DROP COLUMN exec_host_id`,
  `DELETE FROM settings WHERE key = 'remote_exec_hosts_json'`,
];
