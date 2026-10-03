import { z } from "zod";
import { TimestampSchema } from "./projects/primitives.ts";

/**
 * The host's computer-use lease: one thread at a time drives the host's screen through CUA
 * Driver, and the others wait in line. The host owns it (docs/architecture/computer-use.md): a
 * thread's first CUA call takes it, and `end_session`, the end of the thread's turn, or a few
 * quiet minutes give it back.
 *
 * - `thread`: a thread of this host holds it.
 * - `external`: someone outside the lease holds the old lock directory (`/tmp/aop-cua.lock`), a
 *   convention threads used before the host enforced the lease. `owner` is what they wrote in it.
 */
export const CuaLeaseHolderSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("thread"),
    threadId: z.string(),
    projectId: z.string(),
    title: z.string(),
    since: TimestampSchema,
    lastCallAt: TimestampSchema,
  }),
  z.object({
    kind: z.literal("external"),
    owner: z.string().nullable(),
    since: TimestampSchema.nullable(),
  }),
]);
export type CuaLeaseHolder = z.infer<typeof CuaLeaseHolderSchema>;

/** A thread waiting for the lease. `position` 1 is next in line. */
export const CuaLeaseWaiterSchema = z.object({
  threadId: z.string(),
  projectId: z.string(),
  title: z.string(),
  since: TimestampSchema,
  position: z.number().int().positive(),
});
export type CuaLeaseWaiter = z.infer<typeof CuaLeaseWaiterSchema>;

/** `GET /api/computer-use/lease`, also carried by the live view's status. */
export const CuaLeaseStateSchema = z.object({
  holder: CuaLeaseHolderSchema.nullable(),
  /** First in line first. */
  queue: z.array(CuaLeaseWaiterSchema),
  /** How long a holder may go without a CUA call before the host takes the lease back. */
  idleReleaseMs: z.number().int().positive(),
});
export type CuaLeaseState = z.infer<typeof CuaLeaseStateSchema>;

export const EMPTY_CUA_LEASE: CuaLeaseState = { holder: null, queue: [], idleReleaseMs: 180_000 };

/** "next", "2nd", "3rd", "4th"…: a waiter's place, as the person reads it. */
export const cuaLinePlace = (position: number): string => {
  if (position <= 1) return "next";
  const tens = position % 100;
  if (tens >= 11 && tens <= 13) return `${position}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[position % 10] ?? "th";
  return `${position}${suffix}`;
};

/** "Waiting for computer use (2nd in line)". */
export const cuaWaitingLabel = (position: number): string =>
  `Waiting for computer use (${cuaLinePlace(position)} in line)`;

/** Who holds the lease, in a few words: the thread's title, or the lock's owner. */
export const cuaHolderName = (holder: CuaLeaseHolder): string =>
  holder.kind === "thread"
    ? holder.title
    : holder.owner
      ? `${holder.owner} (outside AOP's lease)`
      : "another program (outside AOP's lease)";
