import { getThreadProgress, type Project, type Thread } from "@aop/common";

/**
 * The instructions a project session gets on every turn, as prompt lines. Pure text: what to
 * read is decided by the caller (prompt-context.ts), so these stay easy to test and to change.
 */

export interface BriefRepo {
  id: string;
  name: string;
  path: string;
}

interface BriefBase {
  project: Pick<Project, "name" | "goal" | "instructions">;
  repos: readonly BriefRepo[];
  /** The body of MEMORY.md, or null when the project has none yet. */
  memoryIndex: string | null;
}

export const MEMORY_INDEX_MAX_CHARS = 6000;
export const THREAD_DIGEST_MAX = 20;
const STATUS_LINE_MAX_CHARS = 120;

export const buildCoordinatorBrief = (
  input: BriefBase & { threads: readonly Thread[] },
): string[] => [
  "---",
  `You are the coordinator of the AOP project "${input.project.name}". This section is from AOP, not from the person.`,
  "You talk with the person who owns the project and run their work through threads: separate agent sessions that each do one piece of work in one repository and report back. You only have the AOP tools; you cannot read files or run commands yourself.",
  ...projectContext(input),
  ...repoLines("Repositories in this project (pass the id as repoId):", input.repos),
  ...threadDigest(input.threads),
  "",
  "How you work:",
  "- Decide per message: answer directly when memory, the thread list or a thread report already holds the answer; start a thread (thread_spawn) for work; send to an existing thread (thread_steer) when the message continues what it does; stop one (thread_stop) when the person asks. Batch related asks into as few threads as make sense.",
  "- When the person should choose between approaches, call propose_threads instead of starting work.",
  "- A thread cannot see this conversation. Brief it completely: the goal, the constraints from the instructions, the repository, and what done looks like. Pass the person's own words as `quote` when you forward a message.",
  '- Messages that begin with "Thread report:" are automatic reports from your threads, not from the person. Tell the person only what needs them: a result, a decision a thread waits on, a failure. If a report needs nothing from the person, answer in one short sentence, and do not steer a thread just to acknowledge it.',
  "- Keep MEMORY.md a short index of durable facts (decisions, conventions, where things live) with detail in topic files. Save with memory_write; read with memory_read. Do not save chatter.",
  "- Use project_settings_get and project_settings_set only when asked to change how the project runs.",
  "- Keep replies short and plain.",
];

export const buildThreadBrief = (
  input: BriefBase & { thread: Pick<Thread, "id" | "title" | "repoId">; workspace: string },
): string[] => [
  "---",
  `You are a thread of the AOP project "${input.project.name}", titled "${input.thread.title}". This section is from AOP, not from the person. You do one piece of work, then report.`,
  `Your workspace is ${input.workspace}. Work there.`,
  ...otherRepoLines(input.repos, input.thread.repoId),
  ...projectContext(input),
  "",
  "How you work:",
  "- Keep progress current with aop_report_status: a short checklist of steps (pending, active, done) and one status line of under 100 characters. Update it as you go.",
  "- When you cannot continue without the person's decision, call aop_ask_user with a clear question and, where you can, options (mark at most one as recommended). Then end your turn and write nothing more: the person's answer arrives as your next message. Never ask a blocking question in plain text and carry on.",
  "- When the work is done, reply with a short report: what changed and where (branch, pull request), and what is left. The coordinator reads it.",
  "- Save durable lessons with memory_write and read memory_read when it helps. Keep MEMORY.md a short index.",
];

const projectContext = (input: BriefBase): string[] => [
  `Project goal: ${input.project.goal.trim() || "(not set)"}`,
  ...(input.project.instructions.trim()
    ? [
        "Project instructions from the person (they apply to you and to every thread):",
        input.project.instructions.trim(),
      ]
    : []),
  ...(input.memoryIndex?.trim()
    ? ["Project memory index (MEMORY.md):", clip(input.memoryIndex.trim(), MEMORY_INDEX_MAX_CHARS)]
    : []),
];

const repoLines = (heading: string, repos: readonly BriefRepo[]): string[] =>
  repos.length === 0
    ? ["This project has no repositories."]
    : [heading, ...repos.map((repo) => `- ${repo.id}: ${repo.name} (${repo.path})`)];

const otherRepoLines = (repos: readonly BriefRepo[], ownRepoId: string | null): string[] => {
  const others = repos.filter((repo) => repo.id !== ownRepoId);
  return others.length === 0
    ? []
    : [
        "Other repositories of this project you may read but not change:",
        ...others.map((repo) => `- ${repo.name} (${repo.path})`),
      ];
};

const threadDigest = (threads: readonly Thread[]): string[] => {
  if (threads.length === 0) return ["No threads yet."];
  const shown = threads.slice(0, THREAD_DIGEST_MAX);
  const more = threads.length - shown.length;
  return [
    "Threads, latest activity first:",
    ...shown.map(digestLine),
    ...(more > 0 ? [`(${more} older threads not shown; use thread_list)`] : []),
  ];
};

const digestLine = (thread: Thread): string => {
  const progress = getThreadProgress(thread);
  const detail = [
    progress ? `${progress.done}/${progress.total}` : null,
    thread.liveStatusLine ? clip(thread.liveStatusLine, STATUS_LINE_MAX_CHARS) : null,
  ].filter((part) => part !== null);
  return `- ${thread.id} "${thread.title}" [${thread.status}]${detail.length ? ` ${detail.join(" · ")}` : ""}`;
};

const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;
