/**
 * Migration v11: drops runtime_profiles. Versions 1 to 10 are never edited; a database that
 * applied them only runs these statements.
 *
 * Runtime configuration lives in runtime_configuration_providers and _models. The profiles table
 * belonged to the earlier Sessions product, and nothing writes to it now. Its one reader, the
 * runtime-configuration seed, copied each row into a `legacy_<id>` provider on every start, so
 * a row is normally there already. A database that was never started since an older build
 * saved a profile has not had that copy, so the first two statements make it here, the way the
 * seed did (first word of the command, the reasoning as the only thinking level, the profile's
 * model as the default) before the table goes. A profile whose id or name is already taken
 * is left out, as it was. Its unique name index goes with the table.
 */
export const DROP_RUNTIME_PROFILES_V11_STATEMENTS: readonly string[] = [
  `INSERT OR IGNORE INTO runtime_configuration_providers
      (id, name, command, driver, built_in, position, supports_fast_mode)
    SELECT 'legacy_' || id, name,
      CASE WHEN instr(trim(command), ' ') > 0
        THEN substr(trim(command), 1, instr(trim(command), ' ') - 1)
        ELSE trim(command) END,
      base_provider, 0,
      (SELECT COUNT(*) FROM runtime_configuration_providers)
        + ROW_NUMBER() OVER (ORDER BY created_at, id) - 1,
      fast_mode
    FROM runtime_profiles`,
  `INSERT OR IGNORE INTO runtime_configuration_models
      (id, provider_id, description, model, thinking_levels, fast_mode, built_in, position,
       is_default, default_thinking_level)
    SELECT 'legacy_' || id || '_model', 'legacy_' || id, model, model, json_array(reasoning),
      0, 0, 0, 1, reasoning
    FROM runtime_profiles
    WHERE EXISTS (
      SELECT 1 FROM runtime_configuration_providers WHERE id = 'legacy_' || runtime_profiles.id
    )`,
  `DROP TABLE runtime_profiles`,
];
