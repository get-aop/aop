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
import { getTaskEventEmitter, type TaskEventEmitter } from "./events/index.ts";
import { createRepoRepository, type RepoRepository } from "./repo/repository.ts";
import { createSettingsRepository, type SettingsRepository } from "./settings/repository.ts";

export interface LocalServerContext {
  db: Kysely<Database>;
  authService: AuthService;
  repoRepository: RepoRepository;
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
  taskEventEmitter: TaskEventEmitter;
}

export interface CreateCommandContextOptions {
  taskEventEmitter?: TaskEventEmitter;
}

export const createCommandContext = (
  db: Kysely<Database>,
  options: CreateCommandContextOptions = {},
): LocalServerContext => ({
  db,
  authService: createAuthService({ deviceRepository: createDeviceRepository(db) }),
  repoRepository: createRepoRepository(db),
  chatSessionRepository: createChatSessionRepository(db),
  chatCheckpointRepository: createChatCheckpointRepository(db),
  chatWorkLogRepository: createChatWorkLogRepository(db),
  chatRevertRepository: createChatRevertRepository(db),
  chatCheckpointCleanupRepository: createChatCheckpointCleanupRepository(db),
  sessionMutationLock: createSessionMutationLock(),
  eventPublisher: createEventPublisher(db),
  settingsRepository: createSettingsRepository(db),
  taskEventEmitter: options.taskEventEmitter ?? getTaskEventEmitter(),
});
