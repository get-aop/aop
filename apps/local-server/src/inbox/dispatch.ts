import type {
  InboxContext,
  InboxDispatchDraft,
  InboxDispatchInput,
  InboxItem,
  InboxRules,
  IssueDetail,
} from "@aop/common";
import type { InboxActions } from "./actions.ts";
import {
  assembleBrief,
  contextSection,
  draftBrief,
  draftTitle,
  issueReference,
  issueSection,
  linkSection,
  postBackPreview,
} from "./brief.ts";
import type { InboxResult, InboxService } from "./service.ts";

/**
 * Dispatch a thread from an item (decision D4): the thread starts directly in the repository
 * the person picked, with the brief they edited, and only that thread sees the Slack text. "Ask
 * the coordinator" sends the same brief to the project's coordinator instead. The new thread is
 * linked to the item, with the post-back turned on only when the person confirmed it.
 */
export interface InboxDispatch {
  draft: (id: string) => Promise<InboxResult<{ draft: InboxDispatchDraft }>>;
  dispatch: (
    id: string,
    input: InboxDispatchInput,
  ) => Promise<InboxResult<{ item: InboxItem; threadId: string | null }>>;
}

export interface InboxDispatchDeps {
  inbox: InboxService;
  actions: Pick<InboxActions, "context" | "rules">;
  /** Starts a thread in a project; the error reads as the person would be told it. */
  spawnThread: (
    projectId: string,
    input: { title: string; prompt: string; repoId: string | null },
  ) => Promise<{ id: string; title: string } | { error: string }>;
  /** Sends a plain message to the project's coordinator. */
  askCoordinator: (projectId: string, text: string) => Promise<{ error: string } | null>;
  /** An issue whole, through the Issues tab's service (GitHub, Linear, Jira alike). */
  issueDetail: (projectId: string, key: string) => Promise<IssueDetail | null>;
}

export const createInboxDispatch = (deps: InboxDispatchDeps): InboxDispatch => ({
  draft: async (id) => {
    const found = await deps.inbox.get(id);
    if (!found.success) return found;
    const { item } = found;
    const context = await readContext(deps, item);
    const title = draftTitle(item);
    return {
      success: true,
      draft: {
        title,
        brief: draftBrief(item),
        contextLength: context ? contextSection(context).length : 0,
        projectId: mappedProject(await deps.actions.rules(), item),
        postBackPreview: postBackPreview(title),
      },
    };
  },

  dispatch: async (id, input) => {
    const found = await deps.inbox.get(id);
    if (!found.success) return found;
    const { item } = found;
    if (item.expired) {
      return {
        success: false,
        error: { code: "INVALID_INPUT", message: "This item is past the Inbox's retention" },
      };
    }
    const prompt = assembleBrief(input.brief, await addedSections(deps, item, input));
    const started =
      input.mode === "coordinator"
        ? await askCoordinator(deps, input, prompt)
        : await startThread(deps, item, input, prompt);
    if ("error" in started) return failed(started.error);
    await deps.inbox.setState(id, { state: "read" });
    return refreshed(deps.inbox, id, started.threadId);
  },
});

const askCoordinator = async (
  deps: InboxDispatchDeps,
  input: InboxDispatchInput,
  prompt: string,
): Promise<{ threadId: null } | { error: string }> =>
  (await deps.askCoordinator(input.projectId, prompt)) ?? { threadId: null };

const startThread = async (
  deps: InboxDispatchDeps,
  item: InboxItem,
  input: InboxDispatchInput,
  prompt: string,
): Promise<{ threadId: string } | { error: string }> => {
  const thread = await deps.spawnThread(input.projectId, {
    title: input.title,
    prompt,
    repoId: input.repoId,
  });
  if ("error" in thread) return thread;
  await deps.inbox.link(
    item.id,
    { kind: "thread", ref: thread.id, projectId: input.projectId, title: thread.title },
    // The notes go in the item's Slack thread, so an item with no link to Slack has none.
    { postBack: input.postBack && item.permalink !== null },
  );
  return { threadId: thread.id };
};

const addedSections = async (
  deps: InboxDispatchDeps,
  item: InboxItem,
  input: InboxDispatchInput,
): Promise<string[]> => {
  const sections: string[] = [];
  if (input.includeContext) {
    const context = await readContext(deps, item);
    if (context) sections.push(contextSection(context));
  }
  const issue = input.issueLinkId
    ? item.links.find((link) => link.id === input.issueLinkId && link.kind === "issue")
    : undefined;
  if (issue) {
    const detail = await deps.issueDetail(issue.projectId ?? input.projectId, issue.ref);
    sections.push(detail ? issueSection(detail) : issueReference(issue.ref, issue.url));
  }
  if (input.attachLink && item.permalink) sections.push(linkSection(item.permalink));
  return sections;
};

/** The context the brief would quote; none when the item has no source to read it from now. */
const readContext = async (
  deps: InboxDispatchDeps,
  item: InboxItem,
): Promise<InboxContext | null> => {
  if (item.messageCount <= 1 && !item.threadId && item.conversation.kind === "channel") return null;
  const result = await deps.actions.context(item.id, false);
  return result.success ? result.context : null;
};

const mappedProject = (rules: InboxRules, item: InboxItem): string | null =>
  rules.channels[item.conversation.id]?.projectId ?? null;

const failed = (message: string) =>
  ({ success: false, error: { code: "DISPATCH_FAILED", message } }) as const;

const refreshed = async (
  inbox: InboxService,
  id: string,
  threadId: string | null,
): Promise<InboxResult<{ item: InboxItem; threadId: string | null }>> => {
  const result = await inbox.get(id);
  return result.success ? { success: true, item: result.item, threadId } : result;
};
