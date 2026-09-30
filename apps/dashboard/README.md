# @aop/dashboard

React operational UI for AOP. Built with Bun (no Vite); static assets are produced by `build.ts` and served by `@aop/local-server` in production.

The dashboard is Projects-first. A project is one coordinator chat plus the threads the coordinator starts. The sidebar lists projects with what needs attention in each (threads waiting on you, threads working), `/` shows them as cards, and a project's home is a grid of its threads that changes live as the host's event stream delivers entries. Settings is a dialog over the app for host-level settings (repositories, runtimes, execution hosts, about).

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
| `/projects/:id` | `ThreadGrid` | The project home: its threads as cards, questions first, search |
| `/projects/:id/chat` | `CoordinatorChatPane` | The coordinator chat (placeholder, see [Extension points](#extension-points)) |
| `/projects/:id/threads/:threadId` | `ThreadPane` | One thread (placeholder) |
| `/projects/:id/settings` | `ProjectSettingsPane` | Project settings, memory, usage (placeholder) |
| any other path | none | Rewritten to `/` |

There is no router library: `src/shell/router.tsx` parses the path and `navigate()` uses the History API.

## How the page stays current

`src/projects/live-projects.ts` owns the page's view of every project. It fetches the project list, then opens one `EventSource` per project on `GET /api/projects/:id/stream` (`project-stream.ts`). Each entry is applied by id to a pure state (`projects-state.ts`), so a repeated entry changes nothing.

- **Reconnect.** A dropped connection is resumed by the browser with `Last-Event-ID`. When the browser gives up (any HTTP error, as while the host restarts), a fresh source opens with `?after=` set to the newest entry seen, after a growing delay.
- **Resync.** A `resync` event means the log cannot catch the page up. The page refetches the project and its threads and replaces its state, and replays the entries that arrived while it fetched.
- **Stream cap.** A browser allows six HTTP/1.1 connections to a host, and a stream holds one. At most four projects have a stream (`watch-set.ts`): the open project, then the most recently changed. The rest are refetched every 30 seconds, so their sidebar attention stays roughly current.
- **Pin, icon, colour.** Pinning is a per-device choice kept in local storage. A project's icon is its first letter on a colour taken from its id.

## Pairing

The host answers `401 UNAUTHENTICATED` to a browser it does not know. `src/auth/AuthGate.tsx` asks `GET /api/auth/me` first: the host owner's own dashboard is recognized and goes straight in; any other browser gets the pairing screen (`PairingScreen.tsx`), which trades the one-time code for a device with `POST /api/auth/pair`. The host sets the `aop_device` cookie, which authenticates every request and the event streams. A later 401 (a revoked device) brings the pairing screen back. See `docs/HOST.md`.

`src/api/host.ts` also lets a client served from another origin point at a host and send its device token as a bearer header. A browser keeps that pair in local storage. The desktop app's bundled dashboard is such a client: `src/api/desktop-host.ts` asks the app's main process which host to use before the first request and holds the pair in memory only, so the token never reaches a file the page owns. Such a client reads project streams with `fetch` (`src/api/host-event-source.ts`), because an `EventSource` cannot send the header and the session cookie does not cross origins.

## Extension points

The three placeholder screens live in `src/projects/panes.tsx` and already receive the data they need, typed. Replacing a body changes nothing in the shell.

- `CoordinatorChatPane({ project, threads })`: read messages from `GET /api/projects/:id/messages` and live text and new messages from `useLiveProjects().subscribeEvents(project.id, listener)`, which hears every entry, live-text delta and resync of the project's stream.
- `ThreadPane({ project, thread })`: the thread's transcript and its own composer.
- `ProjectSettingsPane({ project })`: the tab already links here; the project menu's Settings item does too.

## Layout

```text
src/
  projects/     the domain: live state, stream, sidebar rows, project home, New project dialog
  auth/         the authentication gate and the pairing screen
  shell/        the sidebar, router, dialog store, settings dialog, shortcuts
  api/          typed fetch wrapper (request/domain modules), host config, re-export hub
  views/sessions/  chat transcript, composer and diff components kept for the coordinator chat and the thread pane; not mounted yet
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
