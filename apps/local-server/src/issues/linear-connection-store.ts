import { type LinearScope, LinearScopeSchema } from "@aop/common";
import { z } from "zod";
import { type ConnectionStore, connectionsDir, createConnectionStore } from "./connection-store.ts";

/** A project's Linear connection, kept on the host only (connection-store.ts). */
export interface StoredLinearConnection {
  apiKey: string;
  scope: LinearScope;
  workspace: string;
  viewer: string;
}

export type LinearConnectionStore = ConnectionStore<StoredLinearConnection>;

const StoredSchema = z.object({
  apiKey: z.string().min(1),
  scope: LinearScopeSchema,
  workspace: z.string(),
  viewer: z.string(),
});

export const createLinearConnectionStore = (
  dir: () => string = () => connectionsDir("linear"),
): LinearConnectionStore => createConnectionStore(StoredSchema, dir);
