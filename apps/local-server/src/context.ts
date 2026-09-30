import type { Kysely } from "kysely";
import { createDeviceRepository } from "./auth/device-repository.ts";
import { type AuthService, createAuthService } from "./auth/service.ts";
import {
  type ChatCheckpointCleanupRepository,
  createChatCheckpointCleanupRepository,
} from "./chat-session/checkpoint-cleanup-repository.ts";
import {
  type ChatCheckpointRepository,
  createChatCheckpointRepository,
} from "./chat-session/checkpoint-repository.ts";
import {
  type ChatSessionRepository,
  createChatSessionRepository,
} from "./chat-session/repository.ts";
import {
  type ChatRevertRepository,
  createChatRevertRepository,
} from "./chat-session/revert-repository.ts";
import type { SessionHooks } from "./chat-session/session-hooks.ts";
import {
  createSessionMutationLock,
  type SessionMutationLock,
} from "./chat-session/session-mutation-lock.ts";
import {
  type ChatWorkLogRepository,
  createChatWorkLogRepository,
} from "./chat-session/work-log-repository.ts";
import type { Database } from "./db/schema.ts";
import { createEventPublisher, type EventPublisher } from "./event-log/publisher.ts";
import { createMemoryRepository, type MemoryRepository } from "./project/memory-repository.ts";
import { createProjectRepository, type ProjectRepository } from "./project/repository.ts";
import { createProjectSessionHooks } from "./project/session-hooks.ts";
import { createRepoRepository, type RepoRepository } from "./repo/repository.ts";
import { createSettingsRepository, type SettingsRepository } from "./settings/repository.ts";
import { createThreadRepository, type ThreadRepository } from "./thread/repository.ts";

export interface LocalServerContext {
  db: Kysely<Database>;
  authService: AuthService;
  repoRepository: RepoRepository;
  projectRepository: ProjectRepository;
  memoryRepository: MemoryRepository;
  threadRepository: ThreadRepository;
  /** How the chat engine reports message and run changes to the project domain. */
  sessionHooks: SessionHooks;
  chatSessionRepository: ChatSessionRepository;
  chatCheckpointRepository: ChatCheckpointRepository;
  chatWorkLogRepository: ChatWorkLogRepository;
  chatRevertRepository: ChatRevertRepository;
  chatCheckpointCleanupRepository: ChatCheckpointCleanupRepository;
  /** Shared barrier so destructive maintenance cannot race chat mutations. */
  sessionMutationLock: SessionMutationLock;
  /** How domains tell clients a project changed; open project streams deliver it. */
  eventPublisher: EventPublisher;
  settingsRepository: SettingsRepository;
}

export const createCommandContext = (db: Kysely<Database>): LocalServerContext => {
  const eventPublisher = createEventPublisher(db);
  return {
    db,
    authService: createAuthService({ deviceRepository: createDeviceRepository(db) }),
    repoRepository: createRepoRepository(db),
    projectRepository: createProjectRepository(db),
    memoryRepository: createMemoryRepository(db),
    threadRepository: createThreadRepository(db),
    sessionHooks: createProjectSessionHooks(eventPublisher),
    chatSessionRepository: createChatSessionRepository(db),
    chatCheckpointRepository: createChatCheckpointRepository(db),
    chatWorkLogRepository: createChatWorkLogRepository(db),
    chatRevertRepository: createChatRevertRepository(db),
    chatCheckpointCleanupRepository: createChatCheckpointCleanupRepository(db),
    sessionMutationLock: createSessionMutationLock(),
    eventPublisher,
    settingsRepository: createSettingsRepository(db),
  };
};
