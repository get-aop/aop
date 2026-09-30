# @aop/dashboard

React operational UI for AOP. Built with Bun (no Vite); static assets are produced by `build.ts` and served by `@aop/local-server` in production.

The dashboard is Projects-first. A project is one coordinator chat plus the threads the coordinator starts. The sidebar lists projects with what needs attention in each (threads waiting on you, threads working), `/` shows them as cards, and a project's home is its Overview, its threads grouped by what they need from you, which changes live as the host's event stream delivers entries. Settings is a dialog over the app for host-level settings (the run cap, repositories, runtimes, devices, about).

## Run

```bash
# Production-like (via repo root)
./install
open http://aop.localhost:25150

# Dev: HMR against local-server (from repo root)
bun dev
# or dashboard only
bun run dev:dashboard
```

Dev expects `AOP_LOCAL_SERVER_URL` pointing at the API (local-server sets CORS for the dashboard dev origin).

## Routes

| Path | Screen | Purpose |
| --- | --- | --- |
| `/` | `ProjectsIndex` | Every project as a card, search, New project |
| `/projects/:id` | `ThreadOverview` | The project home: counters, then its threads grouped by status (questions first, resolved folded), search |
| `/projects/:id/chat` | `CoordinatorChatPane` | The coordinator chat (see [The coordinator chat](#the-coordinator-chat)) |
| `/projects/:id/threads/:threadId` | `ThreadPane` | One thread: transcript, its question, steering, pull request, changes (see [The thread pane](#the-thread-pane)) |
| `/projects/:id/settings` | `ProjectSettingsPane` | Project settings, memory, usage |
| any other path | none | Rewritten to `/` |

There is no router library: `src/shell/router.tsx` parses the path and `navigate()` uses the History API.

## How the page stays current

`src/projects/live-projects.ts` owns the page's view of every project. It fetches the project list, then opens one `EventSource` per project on `GET /api/projects/:id/stream` (`project-stream.ts`). Each entry is applied by id to a pure state (`projects-state.ts`), so a repeated entry changes nothing.

- **Reconnect.** A dropped connection is resumed by the browser with `Last-Event-ID`. When the browser gives up (any HTTP error, as while the host restarts), a fresh source opens with `?after=` set to the newest entry seen, after a growing delay.
- **Resync.** A `resync` event means the log cannot catch the page up. The page refetches the project and its threads and replaces its state, and replays the entries that arrived while it fetched.
- **A fetch that fails.** The project keeps the host's reason (`threadsError`) until a fetch succeeds, and tries again every three seconds while it has a stream. Until its threads have loaded once, the Threads tab, a thread's page and the coordinator's thread cards show that reason with Try again (`ThreadsLoadError.tsx`) instead of loading forever.
- **Stream cap.** A browser allows six HTTP/1.1 connections to a host, and a stream holds one. At most four projects have a stream (`watch-set.ts`): the open project, then the most recently changed. The rest are refetched every 30 seconds, so their sidebar attention stays roughly current.
- **Pin, icon, colour.** Pinning is a per-device choice kept in local storage. A project's icon is its first letter on a colour taken from its id.

## Pairing

The host answers `401 UNAUTHENTICATED` to a browser it does not know. `src/auth/AuthGate.tsx` asks `GET /api/auth/me` first: the host owner's own dashboard is recognized and goes straight in; any other browser gets the pairing screen (`PairingScreen.tsx`), which trades the one-time code for a device with `POST /api/auth/pair`. The host sets the `aop_device` cookie, which authenticates every request and the event streams. A later 401 (a revoked device) brings the pairing screen back. See `docs/HOST.md`.

`src/api/host.ts` also lets a client served from another origin point at a host and send its device token as a bearer header. A browser keeps that pair in local storage. The desktop app's bundled dashboard is such a client: `src/api/desktop-host.ts` asks the app's main process which host to use before the first request and holds the pair in memory only, so the token never reaches a file the page owns. Such a client reads project streams with `fetch` (`src/api/host-event-source.ts`), because an `EventSource` cannot send the header and the session cookie does not cross origins.

## The coordinator chat

`src/projects/chat/` is the conversation with a project's coordinator. `docs/architecture/coordinator-chat.md` describes how it stays correct across reconnects, resyncs and reloads; in short, `useProjectChat` runs for as long as a project is open, keeps the messages in a pure state applied by message id (`chat-state.ts`), and gets them from a fetch of `GET /api/projects/:id/messages`, from the stream's entries and live-text deltas (`useLiveProjects().subscribeEvents`), and from the message a send returns. Whatever a reply is made of is drawn by `MessageBlocks`: prose with thread and pull request chips, the routing receipt, thread cards that follow their thread, suggested threads, and forwarded quotes. `Composer`, `MessageList` and `MessageBlocks` do not know the coordinator, so the thread pane reuses them.

## The thread pane

`src/projects/thread/` is one thread at `/projects/:id/threads/:threadId`. `docs/architecture/thread-pane.md` describes it; in short, the thread comes from the project's live state, its transcript from `chat/conversation.ts` (the coordinator chat's engine, scoped to the thread id), the tool calls of each turn from `GET /api/threads/:id/activity`, and the changed files from `GET /api/threads/:id/diff`. The pane holds no state the host owns: Stop, Resume, Resolve, Delete, answering and merging call the host (`src/projects/thread-actions.ts`, `thread/use-pull-request.ts`), and the page follows the entry the host publishes. The diff view (`thread/changes/`) takes line comments that queue in the browser and go to the thread as one message.

## Layout

```text
src/
  projects/     the domain: live state, stream, sidebar rows, the Overview, New project dialog
  projects/chat/  the coordinator chat: state, messages and blocks, composer
  projects/thread/  the thread pane: header, transcript, answer card, pull request bar
  projects/thread/changes/  the thread's changed files: diff view and review comments
  auth/         the authentication gate and the pairing screen
  shell/        the sidebar, router, dialog store, settings dialog, shortcuts
  api/          typed fetch wrapper (request/domain modules), host config, re-export hub
  ui/           the one component kit (shadcn + custom)
  components/   dialogs, confirmation host
```

## Settings

- A project's own settings are the screen `/projects/:id/settings` (`src/projects/settings/`): General (name, goal, models and effort, thread access, notifications, restart, pause, archive, delete), Memory (instructions and memory files), Environment (repositories) and Usage.
- The Settings dialog is for the host: General, Repositories (attach dialog with git badges), Runtimes (add/clone/remove custom), Devices (host owner only: pairing code, paired devices, revoke) and About (version/update).
- Kit chrome only: one chip, one menu, one badge. No ad-hoc controls outside `src/ui`

## Scripts

```bash
bun run build       # emit static bundle for local-server
bun run dev         # watch + HMR
bun test
bun run typecheck
```

## Tests

- Unit: `*.test.tsx` next to components. Fixtures and a hand-driven `EventSource` live in `src/projects/test-utils.ts`
- End to end: none in the repository. Drive the dashboard in Chrome against an isolated stack (`.claude/skills/verify`).
