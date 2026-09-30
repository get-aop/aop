import {
  type RuntimeProfileInput,
  RuntimeProfileInputSchema,
  RuntimeProfilePatchSchema,
} from "@aop/common";
import { type Context, Hono } from "hono";
import type { LocalServerContext } from "../context.ts";
import { createRuntimeProfileRepository, type RuntimeProfileRepository } from "./repository.ts";

export const createRuntimeProfileRoutes = (ctx: LocalServerContext) => {
  const routes = new Hono();
  const repository = createRuntimeProfileRepository(ctx.db);

  routes.get("/", async (c) => c.json({ profiles: await repository.list() }));

  routes.post("/", async (c) => {
    const parsed = RuntimeProfileInputSchema.safeParse(await readBody(c));
    if (!parsed.success) return validationResponse(c, parsed.error.issues);

    try {
      return c.json({ profile: await repository.create(parsed.data) }, 201);
    } catch (error) {
      if (isDuplicateNameError(error)) {
        return c.json(
          {
            error: "A runtime profile with this name already exists",
            code: "DUPLICATE_RUNTIME_PROFILE_NAME",
            field: "name",
          },
          409,
        );
      }
      throw error;
    }
  });

  routes.patch("/:id", async (c) => {
    const patch = RuntimeProfilePatchSchema.safeParse(await readBody(c));
    if (!patch.success) return validationResponse(c, patch.error.issues);

    const existing = await repository.get(c.req.param("id"));
    if (!existing) return c.json({ error: "Runtime profile not found" }, 404);

    const merged = RuntimeProfileInputSchema.safeParse({ ...existing, ...patch.data });
    if (!merged.success) return validationResponse(c, merged.error.issues);

    return persistProfileUpdate(c, repository, existing.id, merged.data);
  });

  routes.delete("/:id", async (c) => {
    if (!(await repository.delete(c.req.param("id")))) {
      return c.json({ error: "Runtime profile not found" }, 404);
    }
    return c.body(null, 204);
  });

  return routes;
};

const persistProfileUpdate = async (
  c: Context,
  repository: RuntimeProfileRepository,
  id: string,
  input: RuntimeProfileInput,
) => {
  try {
    return c.json({ profile: await repository.update(id, input) });
  } catch (error) {
    if (!isDuplicateNameError(error)) throw error;
    return c.json(
      {
        error: "A runtime profile with this name already exists",
        code: "DUPLICATE_RUNTIME_PROFILE_NAME",
        field: "name",
      },
      409,
    );
  }
};

const readBody = async (c: { req: { json: () => Promise<unknown> } }): Promise<unknown> =>
  c.req.json().catch(() => null);

const validationResponse = (
  c: { json: (body: unknown, status: 400) => Response },
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>,
) => {
  const issue = issues[0];
  return c.json(
    {
      error: issue?.message ?? "Invalid runtime profile",
      code: "INVALID_RUNTIME_PROFILE",
      field: typeof issue?.path[0] === "string" ? issue.path[0] : undefined,
    },
    400,
  );
};

const isDuplicateNameError = (error: unknown): boolean =>
  error instanceof Error &&
  (error.message.includes("idx_runtime_profiles_name_nocase") ||
    error.message.includes("UNIQUE constraint failed: runtime_profiles.name"));
