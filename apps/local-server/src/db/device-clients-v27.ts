/**
 * Migration v27: a paired device keeps which app and version it last connected with, so AOP
 * settings › Host can list "AOP Nightly app 0.10.8 · macOS" and flag an app older than the host.
 * Versions 1 to 26 are never edited; a database that applied them only runs these statements.
 *
 * All three stay null until the device next makes a request: the desktop app sends its version in
 * a header (CLIENT_HEADER), and a browser is read from its User-Agent.
 */
export const DEVICE_CLIENTS_V27_STATEMENTS: readonly string[] = [
  "ALTER TABLE devices ADD COLUMN client_app TEXT",
  "ALTER TABLE devices ADD COLUMN client_version TEXT",
  "ALTER TABLE devices ADD COLUMN client_platform TEXT",
];
