# @aop/dashboard

React operational UI for AOP. Built with Bun (no Vite); static assets are produced by `build.ts` and served by `@aop/local-server` in production.

The dashboard is Sessions-first: a chat workbench per repository, a composer with model, effort, and access controls, and a right panel (Diff · Checks). Settings covers repositories, runtimes, execution hosts, and about.

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
| `/` | `SessionsPage` | Sessions — rail, thread, composer, right panel |
| `/chat`, `/pool`, `/workers`, `/metrics`, `/settings`, `/workflows/:id`, `/tasks/:id` | — | Legacy redirects to `/` |

## Major UI features

### Sessions

- Rail: scope chips (multi-repo tag awareness), thread list, settled collapsible, footer with update pill and settings deep link
- Draft hero: **aop** wordmark + suggestion chips that prefill the composer
- Composer: runtime/model/effort chip, access mode, Fast chip, attachments, paste collapse, `/` slash commands, `~repo` typeahead
- Thread: day separators (Today / Yesterday / dated), `session` action cards, work-log markers, session git/PR flows
- Right panel: **Diff** (diff viewer) · **Checks** (PR checks)

### Settings

- Repositories (attach dialog with git badges), Runtimes (add/clone/remove custom), Execution hosts, General + License, About (version/update)
- Kit chrome only: one chip, one menu, one badge — no ad-hoc controls outside `src/ui`

## Layout

```text
src/
  views/              page-level routes (Sessions)
  shell/              rail, shortcuts, dialog store, repo scope
  workspace/          right panel (Diff and Checks tabs)
  ui/                 the one component kit (shadcn + custom)
  api/                typed fetch wrapper (request/domain modules), re-export hub
  components/         dialogs, confirmation host
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
- End to end: none in the repository. Drive the dashboard in Chrome against an isolated stack (`.claude/skills/verify`).
