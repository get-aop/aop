import type {
  BuiltInRuntimeConfiguration,
  RuntimeConfigurationModel,
  RuntimeConfigurationModelInput,
  RuntimeConfigurationProvider,
  RuntimeConfigurationProviderInput,
  RuntimeThinkingLevel,
} from "@aop/common";
import {
  BUILT_IN_RUNTIME_CONFIGURATIONS,
  normalizeDefaultThinkingLevel,
  RuntimeThinkingLevelSchema,
  runtimeSupportsFastMode,
} from "@aop/common";
import { generateTypeId } from "@aop/infra";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import type {
  Database,
  RuntimeConfigurationModelRecord,
  RuntimeConfigurationProviderRecord,
} from "../db/schema.ts";

export interface RuntimeConfigurationRepository {
  list: () => Promise<RuntimeConfigurationProvider[]>;
  get: (id: string) => Promise<RuntimeConfigurationProvider | null>;
  createProvider: (
    input: RuntimeConfigurationProviderInput,
  ) => Promise<RuntimeConfigurationProvider>;
  updateProvider: (
    id: string,
    input: RuntimeConfigurationProviderInput,
  ) => Promise<RuntimeConfigurationProvider | null>;
  cloneProvider: (
    id: string,
    input: RuntimeConfigurationProviderInput,
  ) => Promise<RuntimeConfigurationProvider | null>;
  deleteProvider: (id: string) => Promise<boolean>;
  getModel: (id: string) => Promise<RuntimeConfigurationModel | null>;
  createModel: (
    providerId: string,
    input: RuntimeConfigurationModelInput,
  ) => Promise<RuntimeConfigurationModel | null>;
  updateModel: (
    id: string,
    input: RuntimeConfigurationModelInput,
  ) => Promise<RuntimeConfigurationModel | null>;
  deleteModel: (id: string) => Promise<boolean>;
  reorderModels: (
    providerId: string,
    modelIds: string[],
  ) => Promise<RuntimeConfigurationProvider | null>;
  reorderProviders: (providerIds: string[]) => Promise<RuntimeConfigurationProvider[] | null>;
  setDefaultModel: (id: string, isDefault: boolean) => Promise<RuntimeConfigurationProvider | null>;
  setDefaultThinkingLevel: (
    id: string,
    defaultThinkingLevel: RuntimeThinkingLevel | null,
  ) => Promise<RuntimeConfigurationProvider | null>;
  setProviderSupportsFastMode: (
    id: string,
    supportsFastMode: boolean,
  ) => Promise<RuntimeConfigurationProvider | null>;
}

export const createRuntimeConfigurationRepository = (
  db: Kysely<Database>,
): RuntimeConfigurationRepository => ({
  list: async () => {
    await seedBuiltIns(db);
    const providers = await db
      .selectFrom("runtime_configuration_providers")
      .selectAll()
      .orderBy("position", "asc")
      .orderBy(sql`name COLLATE NOCASE`)
      .execute();
    const models = await db.selectFrom("runtime_configuration_models").selectAll().execute();
    return providers.map((provider) => toProvider(provider, models));
  },
  get: async (id) => {
    await seedBuiltIns(db);
    const provider = await db
      .selectFrom("runtime_configuration_providers")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    if (!provider) return null;
    const models = await db
      .selectFrom("runtime_configuration_models")
      .selectAll()
      .where("provider_id", "=", id)
      .execute();
    return toProvider(provider, models);
  },
  createProvider: async (input) => {
    const existing = await db
      .selectFrom("runtime_configuration_providers")
      .select(({ fn }) => fn.count<number>("id").as("count"))
      .executeTakeFirstOrThrow();
    const position = Number(existing.count);
    const record = await db
      .insertInto("runtime_configuration_providers")
      .values({
        id: generateTypeId("rtprov"),
        ...toProviderRecord(input),
        built_in: false,
        position,
        supports_fast_mode: runtimeSupportsFastMode(input.driver),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return toProvider(record, []);
  },
  updateProvider: async (id, input) => {
    const record = await db
      .updateTable("runtime_configuration_providers")
      .set({ ...toProviderPatch(input), updated_at: sql`datetime('now')` })
      .where("id", "=", id)
      .where("built_in", "=", false)
      .returningAll()
      .executeTakeFirst();
    if (!record) return null;
    const models = await db
      .selectFrom("runtime_configuration_models")
      .selectAll()
      .where("provider_id", "=", id)
      .execute();
    return toProvider(record, models);
  },
  cloneProvider: async (id, input) => {
    await seedBuiltIns(db);
    return db.transaction().execute(async (trx) => {
      const source = await trx
        .selectFrom("runtime_configuration_providers")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();
      if (!source) return null;

      const sourceModels = await trx
        .selectFrom("runtime_configuration_models")
        .selectAll()
        .where("provider_id", "=", id)
        .execute();
      const existing = await trx
        .selectFrom("runtime_configuration_providers")
        .select(({ fn }) => fn.count<number>("id").as("count"))
        .executeTakeFirstOrThrow();
      const providerId = generateTypeId("rtprov");
      const provider = await trx
        .insertInto("runtime_configuration_providers")
        .values({
          id: providerId,
          ...toProviderRecord(input),
          built_in: false,
          position: Number(existing.count),
          supports_fast_mode: source.supports_fast_mode,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      const models: RuntimeConfigurationModelRecord[] = [];
      for (const [position, model] of sortModelRecords(sourceModels).entries()) {
        models.push(
          await trx
            .insertInto("runtime_configuration_models")
            .values({
              id: generateTypeId("rtmodel"),
              provider_id: providerId,
              description: model.description,
              model: model.model,
              thinking_levels: model.thinking_levels,
              fast_mode: false,
              built_in: false,
              position,
              is_default: model.is_default,
              default_thinking_level: model.default_thinking_level,
            })
            .returningAll()
            .executeTakeFirstOrThrow(),
        );
      }
      return toProvider(provider, models);
    });
  },
  deleteProvider: async (id) =>
    db.transaction().execute(async (trx) => {
      const result = await trx
        .deleteFrom("runtime_configuration_providers")
        .where("id", "=", id)
        .where("built_in", "=", false)
        .executeTakeFirst();
      if (result.numDeletedRows === 0n) return false;

      const legacyProfileId = getLegacyRuntimeProfileId(id);
      if (legacyProfileId) {
        await trx.deleteFrom("runtime_profiles").where("id", "=", legacyProfileId).execute();
      }
      return true;
    }),
  getModel: async (id) => {
    const record = await db
      .selectFrom("runtime_configuration_models")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    return record ? toModel(record) : null;
  },
  createModel: async (providerId, input) =>
    db.transaction().execute(async (trx) => {
      const provider = await trx
        .selectFrom("runtime_configuration_providers")
        .select("id")
        .where("id", "=", providerId)
        .executeTakeFirst();
      if (!provider) return null;
      const existing = await trx
        .selectFrom("runtime_configuration_models")
        .select(({ fn }) => fn.count<number>("id").as("count"))
        .where("provider_id", "=", providerId)
        .executeTakeFirstOrThrow();
      const position = Number(existing.count);
      const record = await trx
        .insertInto("runtime_configuration_models")
        .values({
          id: generateTypeId("rtmodel"),
          provider_id: providerId,
          ...toModelRecord(input),
          built_in: false,
          position,
          is_default: position === 0,
          default_thinking_level: normalizeDefaultThinkingLevel(
            input.thinkingLevels,
            input.thinkingLevels.includes("medium") ? "medium" : null,
          ),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return toModel(record);
    }),
  updateModel: async (id, input) => {
    const existing = await db
      .selectFrom("runtime_configuration_models")
      .selectAll()
      .where("id", "=", id)
      .where("built_in", "=", false)
      .executeTakeFirst();
    if (!existing) return null;
    const defaultThinkingLevel = normalizeDefaultThinkingLevel(
      input.thinkingLevels,
      parseDefaultThinkingLevel(existing.default_thinking_level) ??
        (input.thinkingLevels.includes("medium") ? "medium" : null),
    );
    const record = await db
      .updateTable("runtime_configuration_models")
      .set({
        ...toModelRecord(input),
        default_thinking_level: defaultThinkingLevel,
        updated_at: sql`datetime('now')`,
      })
      .where("id", "=", id)
      .where("built_in", "=", false)
      .returningAll()
      .executeTakeFirst();
    return record ? toModel(record) : null;
  },
  deleteModel: async (id) => {
    const result = await db
      .deleteFrom("runtime_configuration_models")
      .where("id", "=", id)
      .where("built_in", "=", false)
      .executeTakeFirst();
    return result.numDeletedRows > 0n;
  },
  reorderModels: async (providerId, modelIds) =>
    db.transaction().execute(async (trx) => {
      const provider = await trx
        .selectFrom("runtime_configuration_providers")
        .selectAll()
        .where("id", "=", providerId)
        .executeTakeFirst();
      if (!provider) return null;
      const models = await trx
        .selectFrom("runtime_configuration_models")
        .selectAll()
        .where("provider_id", "=", providerId)
        .execute();
      const existingIds = new Set(models.map((model) => model.id));
      if (
        modelIds.length !== models.length ||
        new Set(modelIds).size !== modelIds.length ||
        modelIds.some((id) => !existingIds.has(id))
      ) {
        return null;
      }
      for (const [position, id] of modelIds.entries()) {
        await trx
          .updateTable("runtime_configuration_models")
          .set({ position, updated_at: sql`datetime('now')` })
          .where("id", "=", id)
          .execute();
      }
      const positions = new Map(modelIds.map((id, position) => [id, position] as const));
      return toProvider(
        provider,
        models.map((model) => ({ ...model, position: positions.get(model.id) ?? model.position })),
      );
    }),
  reorderProviders: async (providerIds) =>
    db.transaction().execute(async (trx) => {
      const providers = await trx
        .selectFrom("runtime_configuration_providers")
        .selectAll()
        .execute();
      const existingIds = new Set(providers.map((provider) => provider.id));
      if (
        providerIds.length !== providers.length ||
        new Set(providerIds).size !== providerIds.length ||
        providerIds.some((id) => !existingIds.has(id))
      ) {
        return null;
      }
      for (const [position, id] of providerIds.entries()) {
        await trx
          .updateTable("runtime_configuration_providers")
          .set({ position, updated_at: sql`datetime('now')` })
          .where("id", "=", id)
          .execute();
      }
      const models = await trx.selectFrom("runtime_configuration_models").selectAll().execute();
      const positions = new Map(providerIds.map((id, position) => [id, position] as const));
      return providers
        .map((provider) => ({
          ...provider,
          position: positions.get(provider.id) ?? provider.position,
        }))
        .sort(
          (left, right) => left.position - right.position || left.name.localeCompare(right.name),
        )
        .map((provider) => toProvider(provider, models));
    }),
  setProviderSupportsFastMode: async (id, supportsFastMode) => {
    const record = await db
      .updateTable("runtime_configuration_providers")
      .set({ supports_fast_mode: supportsFastMode, updated_at: sql`datetime('now')` })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
    if (!record) return null;
    const models = await db
      .selectFrom("runtime_configuration_models")
      .selectAll()
      .where("provider_id", "=", id)
      .execute();
    return toProvider(record, models);
  },
  setDefaultModel: async (id, isDefault) =>
    db.transaction().execute(async (trx) => {
      const target = await trx
        .selectFrom("runtime_configuration_models")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();
      if (!target) return null;
      if (isDefault) {
        await trx
          .updateTable("runtime_configuration_models")
          .set({ is_default: false, updated_at: sql`datetime('now')` })
          .where("provider_id", "=", target.provider_id)
          .execute();
      }
      await trx
        .updateTable("runtime_configuration_models")
        .set({ is_default: isDefault, updated_at: sql`datetime('now')` })
        .where("id", "=", id)
        .execute();
      const provider = await trx
        .selectFrom("runtime_configuration_providers")
        .selectAll()
        .where("id", "=", target.provider_id)
        .executeTakeFirstOrThrow();
      const models = await trx
        .selectFrom("runtime_configuration_models")
        .selectAll()
        .where("provider_id", "=", target.provider_id)
        .execute();
      return toProvider(provider, models);
    }),
  setDefaultThinkingLevel: async (id, defaultThinkingLevel) => {
    const target = await db
      .selectFrom("runtime_configuration_models")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    if (!target) return null;

    const levels = parseThinkingLevels(target.thinking_levels);
    const normalized = normalizeDefaultThinkingLevel(levels, defaultThinkingLevel);
    if (defaultThinkingLevel !== null && normalized !== defaultThinkingLevel) {
      return null;
    }

    await db
      .updateTable("runtime_configuration_models")
      .set({
        default_thinking_level: normalized,
        updated_at: sql`datetime('now')`,
      })
      .where("id", "=", id)
      .execute();

    const provider = await db
      .selectFrom("runtime_configuration_providers")
      .selectAll()
      .where("id", "=", target.provider_id)
      .executeTakeFirstOrThrow();
    const models = await db
      .selectFrom("runtime_configuration_models")
      .selectAll()
      .where("provider_id", "=", target.provider_id)
      .execute();
    return toProvider(provider, models);
  },
});

const seedBuiltIns = async (db: Kysely<Database>) => {
  for (const [index, configuration] of BUILT_IN_RUNTIME_CONFIGURATIONS.entries()) {
    const { id, name, command, driver, models, supportsFastMode } = configuration;
    await db
      .insertInto("runtime_configuration_providers")
      .values({
        id,
        name,
        command,
        driver,
        built_in: true,
        position: index,
        supports_fast_mode: supportsFastMode,
      })
      .onConflict((oc) =>
        oc.column("id").doUpdateSet({
          name,
          command,
          driver,
          built_in: true,
          // Keep user-chosen has-fast preference across reseeds (set only on insert).
        }),
      )
      .execute();
    for (const [position, model] of models.entries()) {
      await insertBuiltInModel(db, configuration, model, position);
    }
    await db
      .deleteFrom("runtime_configuration_models")
      .where("provider_id", "=", id)
      .where("built_in", "=", true)
      .where(
        "model",
        "not in",
        models.map((model) => model.model),
      )
      .execute();
  }
  const profiles = await db.selectFrom("runtime_profiles").selectAll().execute();
  const providerCount = await db
    .selectFrom("runtime_configuration_providers")
    .select(({ fn }) => fn.count<number>("id").as("count"))
    .executeTakeFirstOrThrow();
  let nextPosition = Number(providerCount.count);
  for (const profile of profiles) {
    const providerId = `legacy_${profile.id}`;
    const inserted = await db
      .insertInto("runtime_configuration_providers")
      .values({
        id: providerId,
        name: profile.name,
        command: normalizeExecutable(profile.command),
        driver: profile.base_provider,
        built_in: false,
        position: nextPosition,
        supports_fast_mode:
          Boolean(profile.fast_mode) ||
          runtimeSupportsFastMode(profile.base_provider as RuntimeConfigurationProvider["driver"]),
      })
      .onConflict((oc) => oc.column("id").doNothing())
      .executeTakeFirst();
    if (Number(inserted.numInsertedOrUpdatedRows ?? 0) > 0) nextPosition += 1;
    await db
      .insertInto("runtime_configuration_models")
      .values({
        id: `${providerId}_model`,
        provider_id: providerId,
        description: profile.model,
        model: profile.model,
        thinking_levels: JSON.stringify([profile.reasoning]),
        fast_mode: false,
        built_in: false,
        position: 0,
        is_default: true,
        default_thinking_level: profile.reasoning,
      })
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();
  }
};

const insertBuiltInModel = async (
  db: Kysely<Database>,
  configuration: BuiltInRuntimeConfiguration,
  model: BuiltInRuntimeConfiguration["models"][number],
  position: number,
) => {
  const providerId = configuration.id;
  // Prefer medium as the built-in default when the model supports it; users can override.
  const defaultThinkingLevel = normalizeDefaultThinkingLevel(
    model.thinkingLevels,
    model.thinkingLevels.includes("medium") ? "medium" : null,
  );
  await db
    .insertInto("runtime_configuration_models")
    .values({
      id: `builtin_${providerId}_${model.model}`.replaceAll(/[^A-Za-z0-9_]/g, "_"),
      provider_id: providerId,
      description: model.description,
      model: model.model,
      thinking_levels: JSON.stringify(model.thinkingLevels),
      fast_mode: false,
      built_in: true,
      position,
      is_default: position === 0,
      default_thinking_level: defaultThinkingLevel,
    })
    .onConflict((oc) =>
      oc.columns(["provider_id", "model"]).doUpdateSet({
        description: model.description,
        thinking_levels: JSON.stringify(model.thinkingLevels),
        // Promote custom rows to built-in and adopt catalog order only on first promotion.
        // Already-built-in rows keep user-chosen order across reseeds.
        built_in: true,
        position: sql`CASE WHEN built_in = 0 THEN ${position} ELSE position END`,
        // Seed a default only when missing; otherwise keep the user choice (normalized on read).
        default_thinking_level: sql`CASE
          WHEN default_thinking_level IS NULL THEN ${defaultThinkingLevel}
          ELSE default_thinking_level
        END`,
      }),
    )
    .execute();
};

const normalizeExecutable = (command: string): string => command.trim().split(/\s+/)[0] ?? command;

const getLegacyRuntimeProfileId = (providerId: string): string | null => {
  const prefix = "legacy_";
  return providerId.startsWith(prefix) ? providerId.slice(prefix.length) : null;
};

const toProviderRecord = (input: RuntimeConfigurationProviderInput) => ({
  name: input.name,
  command: input.command,
  driver: input.driver,
});

const toProviderPatch = (input: RuntimeConfigurationProviderInput) => ({
  name: input.name,
  command: input.command,
  driver: input.driver,
});

const toModelRecord = (input: RuntimeConfigurationModelInput) => ({
  description: input.description,
  model: input.model,
  thinking_levels: JSON.stringify(input.thinkingLevels),
  fast_mode: false,
});

const toProvider = (
  record: RuntimeConfigurationProviderRecord,
  models: RuntimeConfigurationModelRecord[],
): RuntimeConfigurationProvider => ({
  id: record.id,
  name: record.name,
  command: record.command,
  driver: record.driver as RuntimeConfigurationProvider["driver"],
  builtIn: Boolean(record.built_in),
  position: record.position,
  supportsFastMode: Boolean(record.supports_fast_mode),
  models: sortModelRecords(models.filter((model) => model.provider_id === record.id)).map(toModel),
});

const sortModelRecords = (
  models: RuntimeConfigurationModelRecord[],
): RuntimeConfigurationModelRecord[] =>
  [...models].sort(
    (left, right) =>
      left.position - right.position ||
      left.created_at.localeCompare(right.created_at) ||
      left.id.localeCompare(right.id),
  );

const toModel = (record: RuntimeConfigurationModelRecord): RuntimeConfigurationModel => {
  const thinkingLevels = parseThinkingLevels(record.thinking_levels);
  return {
    id: record.id,
    providerId: record.provider_id,
    description: record.description,
    model: record.model,
    thinkingLevels,
    builtIn: Boolean(record.built_in),
    position: record.position,
    isDefault: Boolean(record.is_default),
    defaultThinkingLevel: normalizeDefaultThinkingLevel(
      thinkingLevels,
      parseDefaultThinkingLevel(record.default_thinking_level),
    ),
  };
};

const parseThinkingLevels = (value: string): RuntimeThinkingLevel[] => {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      const result = RuntimeThinkingLevelSchema.safeParse(item);
      return result.success ? [result.data] : [];
    });
  } catch {
    return [];
  }
};

const parseDefaultThinkingLevel = (value: string | null): RuntimeThinkingLevel | null => {
  if (value === null) return null;
  const result = RuntimeThinkingLevelSchema.safeParse(value);
  return result.success ? result.data : null;
};
