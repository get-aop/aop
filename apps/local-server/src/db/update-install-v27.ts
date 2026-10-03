/**
 * Migration v27: the host's install policy replaces Nightly's on/off auto-install. Versions 1 to
 * 26 are never edited; a database that applied them only runs these statements.
 *
 * `update_auto_apply` ("true" or "false", read only by AOP Nightly) becomes `update_install`:
 * "true" installs once no turn is running, which is "idle"; "false" leaves it to a person, which
 * is "ask". Every host stored the old key with its default at start, so a Nightly host that never
 * touched it gets "idle" and a Stable one "ask", the new defaults. The old key goes: no build
 * reads it any more.
 */
export const UPDATE_INSTALL_V27_STATEMENTS: readonly string[] = [
  `INSERT INTO settings (key, value)
    SELECT 'update_install', CASE WHEN value = 'true' THEN 'idle' ELSE 'ask' END
    FROM settings WHERE key = 'update_auto_apply'
    ON CONFLICT(key) DO NOTHING`,
  `DELETE FROM settings WHERE key = 'update_auto_apply'`,
];
