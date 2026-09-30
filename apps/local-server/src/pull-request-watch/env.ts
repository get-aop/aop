import type { Project, PullRequestRef, Thread } from "@aop/common";
import type { LocalServerContext } from "../context.ts";
import type { Repo } from "../db/schema.ts";
import type { RunGh } from "../github-cli/index.ts";
import type { ChatEngine } from "../project/engine.ts";
import type { ThreadPullRequests } from "../thread/pull-request.ts";
import type { ThreadService } from "../thread/service.ts";
import type { WatchRepository } from "./repository.ts";

/** What one poll of a pull request works with. */
export interface WatchEnv {
  ctx: LocalServerContext;
  runGh: RunGh;
  repository: WatchRepository;
  /** How a person's message reaches a thread: its queue, its worktree and the project's state all apply. */
  send: ThreadService["send"];
  /** Brings a thread in line with its pull request, landing it when it merged. */
  syncPullRequest: ThreadPullRequests["syncPullRequest"];
  /** Starts a coordinator's queued reports once the transaction that stored them has committed. */
  wake: ChatEngine["wake"];
  /** How many fix prompts one thread's pull request gets before the watcher gives up. */
  maxAttempts: number;
  now: () => Date;
}

/** A thread whose open pull request is being polled, with everything it needs. */
export interface WatchTarget {
  thread: Thread;
  repo: Repo;
  project: Project;
  pullRequest: PullRequestRef;
}
