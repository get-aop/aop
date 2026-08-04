# @aop/dashboard

React operational UI for AOP. Built with Bun (no Vite); static assets are produced by `build.ts` and served by `@aop/local-server` in production.

The dashboard is Sessions-first: a chat workbench per repository, a composer with runtime/workflow controls, a right panel (Tasks · Checks · Logs · Changes), a terminal dock, and task detail at `/tasks/:id`. Settings covers repositories, runtimes, execution hosts, workflows, and about.

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

| Path | View | Purpose |
|------|------|---------|
| `/` | `SessionsPage` | Sessions — rail, thread, composer, right panel, terminal dock |
| `/tasks/:taskId` | `TaskDetail` | Logs, plan, specs, steps, retry/resume, PR actions |
| `/settings` | `SettingsPage` | General + License, Repositories, Runtimes, Execution hosts, Workflows, About |
| `/chat`, `/pool`, `/workers`, `/metrics`, `/workflows/:id`, `/review-inbox` | — | Legacy redirects to `/` |

## Major UI features

### Sessions

- Rail: scope chips (multi-repo tag awareness), thread list, settled collapsible, footer with update pill and settings deep links
- Draft hero: **aop** wordmark + suggestion chips that prefill the composer (**Run “Ship it”** also arms the seed workflow)
- Composer: runtime/model/effort chip, access mode, Fast chip, `#workflow` rail (step glyphs + hover detail), git row (Current checkout · diff · Tasks), attachments, `%`/`$`/`@` typeahead
- Thread: day separators (Today / Yesterday / dated), action cards, work-log markers, delegation history, session git/PR flows
- Right panel: **Tasks** (background tasks + delegations from the delegation-center store) · **Checks** · **Logs** · **Changes** (diff viewer)
- Terminal dock: full-width bottom dock (⌘J), per-session state, vertical resize persisted

### Task detail

- Own header: **← Sessions**, title, status badge, mono meta, PR actions
- Tabs: **Logs** (SSE stream), **Plan**, **Specs** (inline review annotations)
- Step list rendered with `workflow-glyphs` (same renderer as the composer rail and Settings)
- Blocked/paused status with Retry / Resume; resume/retry through `ui/dialog`

### Workflows

- Settings → **Workflows**: list + inline expand-to-edit (name, step rows: kind/provider/model/effort/Fast), “Add step” (4 kinds, max 8), fixed auto-debug footnote, seed **“Ship it”** on first open
- Legacy detection by decompile (`simple-workflow.ts`); legacy rows run/delete only
- `#workflow` composer picker with mini glyph previews; rail selection shows full step chips

### Settings

- Repositories (attach dialog with git badges), Runtimes (add/clone/remove custom), Execution hosts, General + License, About (version/update)
- Kit chrome only: one chip, one menu, one badge — no ad-hoc controls outside `src/ui`

## Layout

```text
src/
  views/              page-level routes (Sessions, TaskDetail, Settings)
  shell/              rail, shortcuts, dialog store, repo scope
  workflow/           simple-workflow model + step glyph renderer
  workspace/          right panel, tasks pane, terminal dock
  ui/                 the one component kit (shadcn + custom)
  api/                typed fetch wrapper (request/domain modules), re-export hub
  components/         dialogs, markdown viewers, delegation center
```

## Scripts

```bash
bun run build       # emit static bundle for local-server
bun run dev         # watch + HMR
bun test
bun run typecheck
```

## Tests

- Unit: `*.test.tsx` next to components
- E2E: `e2e-tests/src/dashboard.e2e.ts` (Playwright, `bun run test:e2e:dashboard`)
