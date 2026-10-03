# @aop/dashboard

React operational UI for AOP. Built with Bun (no Vite); static assets are produced by `build.ts` and served by `@aop/local-server` in production.

The dashboard is Projects-first. A project is one coordinator chat plus the threads the coordinator starts. There is no sidebar: the top bar's project switcher lists projects with what needs attention in each (threads waiting on you, threads working), `/` shows them as cards, and a project's home is its Overview, its threads grouped by what they need from you, which changes live as the host's event stream delivers entries. Settings is a dialog over the app for host-level settings (the run cap, repositories, runtimes, devices, about).

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
| `/projects/:id` | `ProjectLayout` | The project screen in three panes (see [The project screen](#the-project-screen)): the coordinator chat (`CoordinatorChatPane`, see [The coordinator chat](#the-coordinator-chat)) in the middle and the threads panel at the right, on the overview (`ThreadOverview`: a greeting, then its threads grouped by status, questions first, resolved folded, with search and filter) |
| `/projects/:id/threads/:threadId` | `ProjectLayout` | The same screen with one thread in the panel (`ThreadPane`: transcript, its question, steering, pull request, changes; see [The thread pane](#the-thread-pane)) |
| `/projects/:id/chat` | none | The chat's old address; rewritten to `/projects/:id` |
| `/projects/:id/settings` (and `/memory`, `/environment`, `/usage`) | `ProjectSettingsDialog` | The project's settings in a dialog over the project screen, which stays mounted underneath; × and Escape go back to the screen it opened over |
| any other path | none | Rewritten to `/` |

There is no router library: `src/shell/router.tsx` parses the path and `navigate()` uses the History API.

## How the page stays current

`src/projects/live-projects.ts` owns the page's view of every project. It fetches the project list, then opens one `EventSource` per project on `GET /api/projects/:id/stream` (`project-stream.ts`). Each entry is applied by id to a pure state (`projects-state.ts`), so a repeated entry changes nothing.

- **Reconnect.** A dropped connection is resumed by the browser with `Last-Event-ID`. When the browser gives up (any HTTP error, as while the host restarts), a fresh source opens with `?after=` set to the newest entry seen, after a growing delay.
- **Resync.** A `resync` event means the log cannot catch the page up. The page refetches the project and its threads and replaces its state, and replays the entries that arrived while it fetched.
- **A fetch that fails.** The project keeps the host's reason (`threadsError`) until a fetch succeeds, and tries again every three seconds while it has a stream. Until its threads have loaded once, the Threads tab, a thread's page and the coordinator's thread cards show that reason with Try again (`ThreadsLoadError.tsx`) instead of loading forever.
- **Stream cap.** A browser allows six HTTP/1.1 connections to a host, and a stream holds one. At most four projects have a stream (`watch-set.ts`): the open project, then the most recently changed. The rest are refetched every 30 seconds, so their attention in the project switcher stays roughly current.
- **Pin, icon, colour.** Pinning is a per-device choice kept in local storage. A project's icon is its first letter on a colour taken from its id.

## Pairing

The host answers `401 UNAUTHENTICATED` to a browser it does not know. `src/auth/AuthGate.tsx` asks `GET /api/auth/me` first: the host owner's own dashboard is recognized and goes straight in; any other browser gets the pairing screen (`PairingScreen.tsx`), which trades the one-time code for a device with `POST /api/auth/pair`. The host sets the `aop_device` cookie, which authenticates every request and the event streams. A later 401 (a revoked device) brings the pairing screen back. The pairing screen tells the person to get a code from AOP settings › Host › Pair a device or `aop pair` on the host. Inside the desktop app the pairing screen never shows: the app pairs on its own screens, so a 401 hands over to the app's status screen (`api/desktop-host.ts`). See `docs/HOST.md`.

`src/api/host.ts` also lets a client served from another origin point at a host and send its device token as a bearer header. A browser keeps that pair in local storage. The desktop app's bundled dashboard is such a client: `src/api/desktop-host.ts` asks the app's main process which host to use before the first request and holds the pair in memory only, so the token never reaches a file the page owns. Such a client reads project streams with `fetch` (`src/api/host-event-source.ts`), because an `EventSource` cannot send the header and the session cookie does not cross origins.

## The coordinator chat

`src/projects/chat/` is the conversation with a project's coordinator. `docs/architecture/coordinator-chat.md` describes how it stays correct across reconnects, resyncs and reloads; in short, `useProjectChat` runs for as long as a project is open, keeps the messages in a pure state applied by message id (`chat-state.ts`), and gets them from a fetch of `GET /api/projects/:id/messages`, from the stream's entries and live-text deltas (`useLiveProjects().subscribeEvents`), and from the message a send returns. Whatever a reply is made of is drawn by `MessageBlocks`: prose with thread and pull request chips, the routing receipt, thread cards that follow their thread, suggested threads (the host records their Start and Skip answers and republishes the message as `message.updated`), and forwarded quotes. `Composer`, `MessageList` and `MessageBlocks` do not know the coordinator, so the thread pane reuses them. The composer's `@` picker, which puts a thread into the message as its link `[title](thread:<id>)`, lives in `src/projects/chat/mentions/`.

## The project screen

`src/projects/layout/` lays a project out in two panes across the whole width: the coordinator chat, which is always mounted, and a threads panel. The panel shows the overview or, when the address names a thread, that thread under a breadcrumb; closing the panel on a thread takes the thread off the address. The top bar (`ProjectTopBar`, which starts with `shell/ShellNav`: back/forward, the project switcher and the new-project button, and ends with `shell/ShellStatus`) holds the panel toggle, which has a dot while a thread waits on the person. See [The top bar](#the-top-bar).

How the panes share the room depends on the width of the screen, measured with a `ResizeObserver` (`panel-layout.ts`): from 900px the panel sits beside the chat with a draggable divider; from 600px it lies over the chat; below that only one pane shows at a time, switched from the top bar. Only the wide layout uses the remembered open state. This browser remembers the panel's open state and width in `localStorage` under `aop:threads-panel:v1`; a blocked storage only means nothing is remembered. Expanding the panel hides the chat without unmounting it, so the chat keeps its stream, scroll place and draft.

## The thread pane

`src/projects/thread/` is one thread at `/projects/:id/threads/:threadId`. `docs/architecture/thread-pane.md` describes it; in short, the thread comes from the project's live state, its transcript from `chat/conversation.ts` (the coordinator chat's engine, scoped to the thread id), the tool calls of each turn from `GET /api/threads/:id/activity`, and the changed files from `GET /api/threads/:id/diff`. The pane holds no state the host owns: Stop, Resume, Resolve, Delete, answering and merging call the host (`src/projects/thread-actions.ts`, `thread/use-pull-request.ts`), and the page follows the entry the host publishes. The diff view (`thread/changes/`) takes line comments that queue in the browser and go to the thread as one message.

## The top bar

The dashboard has no sidebar; every screen has one top bar, so the project screen gets the whole width. A project's screens use `ProjectTopBar`; a screen with no project open (`/`, a project that is loading or missing) uses `shell/AppTopBar`. Both start with `shell/ShellNav` and end with `shell/ShellStatus`.

- **Back and forward** walk the app's own history (hidden under 640px).
- **The project switcher** (`shell/project-switcher/`) is the app's menu. Its chip names the open project (or reads "Select a project") and carries a dot while another project has a thread waiting on the person. A click or ⌘K (anywhere, even while typing) opens a popover: a search field, focused, that filters by name or goal; the projects in three groups (Pinned, Projects, Archived), each with its waiting count or working dot and a check on the open one; then New project (⌘N), All projects and AOP settings (⌘,); and a last line with the host connection and version that opens About. Arrows (they wrap and reach the actions), Enter and Escape work as in any command list. Picking another project keeps the panel's tab or the settings section (`switchProjectPath`); from a thread, pull request, artifact or the browser it lands on the project's home. The open state lives in the dialog store, so ⌘K reaches whichever top bar is on screen.
- **+** opens the New project dialog (⌘N).
- **The far end** (`ShellStatus`) holds host-wide state: the live view's Show button, the Updates button (`updates/UpdatesButton.tsx`, shown only when something can be updated, an update is running or one failed; it reads "Updating host…" on every device while the host updates, and opens the popover with This app, Host <name> and the agent CLIs), permission checks off (opens AOP settings › Runtimes; its words drop on a narrow bar), "Host unreachable" when the host stops answering, then the Claude plan's usage meter.

Project actions (Overview, the AOP Browser, the gear, the `…` menu, "Live") stay with the project, apart from the app-wide items in the switcher, so the scope of each menu is clear. In the desktop app the Mac's app menu has AOP › Settings… (⌘,), which the app hands to the page through the preload bridge (`onOpenSettings`), loading the dashboard first if it is not showing.

## Layout

```text
src/
  projects/     the domain: live state, stream, the Overview, New project dialog
  projects/layout/  the project screen's panes: top-level layout, threads panel, divider, remembered state
  projects/chat/  the coordinator chat: state, messages and blocks, composer
  projects/thread/  the thread pane: header, transcript, answer card, pull request bar
  projects/thread/changes/  the thread's changed files: diff view and review comments
  auth/         the authentication gate and the pairing screen
  updates/      the Updates button and popover, its rows, the turns-running dialog
  host-setup/   the "Set up this host" card on the home page
  shell/        top bar start and end (ShellNav, project-switcher/, ShellStatus), router, dialog store, settings dialog, shortcuts
  api/          typed fetch wrapper (request/domain modules), host config, re-export hub
  ui/           the one component kit (shadcn + custom)
  components/   dialogs, confirmation host
```

## Settings

- A project's own settings are a dialog over the project at `/projects/:id/settings` (`src/projects/settings/`), in sections with a side nav: General (name and icon, goal, instructions), Models, Threads & permissions (thread access, pull requests, auto-continue), Computer use, Notifications, Environment (repositories), Memory (memory files), Usage and Advanced (pause, restart, archive, and delete under Danger zone). Every setting saves as it changes (`use-settings-autosave.ts`): no Save button, and each row says when it is saved.
- The AOP settings dialog is for the host: General, Host (the setup checklist with Fix and How to, and the paired devices with their app version, pairing and revoke), Updates (every update setting: this app, the host, the agent CLIs, and who can update this host), Repositories (attach dialog with git badges), Runtimes (permission checks, and add/clone/remove custom), Computer use and About (versions only). Until the setup checklist is complete, the home page shows it as a "Set up this host" card (`host-setup/HostSetupCard.tsx`).
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
