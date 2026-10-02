# Routines

A routine is work a project does on a schedule: "every weekday at 9:00, summarize new issues and pull requests", "every Friday, write the weekly report", "every hour, check CI on main". Each time it comes due, the host starts a new thread with the routine's brief, or sends the brief to the project's coordinator. The code is `apps/local-server/src/routine/` (scheduler, rules, routes), the schedule engine and wire types are in `packages/common/src/routines/`, and the dashboard's Routines tab is `apps/dashboard/src/projects/routines/`.

## What a routine holds

| Field | Meaning |
| --- | --- |
| `name`, `prompt` | What it is called and the brief every run gets. A run cannot see earlier runs or the chat, so the brief must be complete. |
| `schedule` | When it runs, on the host's clock (below). |
| `target` | `thread` (the default) starts a new thread each run; `coordinator` sends the brief to the project chat as a message, marked with the routine's name. |
| `repoId`, `model`, `effort` | For a thread: its repository (required when the project has several) and, optionally, a model and effort other than the project's thread settings. |
| `enabled` | On, or paused. A paused routine keeps its settings and history; turned back on, it counts from now and does not owe the runs it would have made. |
| `catchUp` | Runs missed while the host was off: `skip` (the default) records one `missed` entry that says how many, `run-once` runs once when the host is back. |

`nextRunAt` and `lastRun` come with every routine. A run's history is kept (newest 50) with its status, why it did not run when it did not, and the thread or message it made.

## Schedules

Every schedule is read on the host's own clock, in its time zone (`GET /api/projects/:id/routines` returns `timeZone`), and every kind is turned into a five-field cron expression, so one engine finds the occurrences:

| Kind | Example | In plain words |
| --- | --- | --- |
| `daily` | `{"kind":"daily","time":"09:00"}` | Every day at 09:00 |
| `weekdays` | `{"kind":"weekdays","time":"09:00"}` | Weekdays at 09:00 |
| `weekly` | `{"kind":"weekly","days":[1,5],"time":"17:00"}` (0 is Sunday) | Every Monday and Friday at 17:00 |
| `hourly` | `{"kind":"hourly","every":3,"minute":15}` (counted from midnight) | Every 3 hours at 15 past |
| `cron` | `{"kind":"cron","expression":"0 9 1 * *"}` | Custom: 0 9 1 * * |

Cron takes `*`, values, ranges, steps, lists, month and weekday names, 7 for Sunday and the `@daily`-style shorthands; when both day fields are set, a day matching either runs (as in Vixie cron).

Daylight saving time: a routine keeps its wall-clock time across both changes. A time that does not exist on the night clocks go forward (02:30) runs just after the jump (03:30); a time that happens twice on the night clocks go back runs once, at its first showing. An hourly routine skips the lost hour and does not repeat the doubled one.

## When a run happens, and when it does not

The scheduler wakes for the soonest next run, and at least once a minute. For each routine that is due it decides:

1. **Missed.** An occurrence more than 2 minutes late was missed (the host was off or asleep). With `catchUp: skip` the run is recorded as `missed` ("Missed 4 runs while the host was off") and nothing starts; with `run-once` one `catch-up` run starts. Either way the next run is the next occurrence after now.
2. **Skipped.** The project is paused, or the routine's previous run is still working (its thread is working, queued, waiting on the person or on a usage limit, or its coordinator message has not been answered). The occurrence is recorded as `skipped` with the reason. An archived project's routines do not come due at all.
3. **Deferred.** The Claude plan's usage limit is reached (a 5-hour or 7-day window the host last heard at 100% that has not reset, or, for a coordinator routine, the coordinator's own wait on a limit). With the project's auto-continue on, the run waits for the reset: it is recorded as `deferred`, the routine's next run is the reset, and at the reset the same entry starts its work. With auto-continue off the occurrence is `skipped`. Either way the limit costs no failed turns.
4. Otherwise the run starts. Its status (`running`, `ok`, `failed`) is read from the thread or chat turn it started, so it is right however that turn ends.

"Run now" (`POST /api/projects/:id/routines/:routineId/run`) starts a run outside the schedule and leaves the next scheduled run where it was. It is refused while the previous run is still working and while the project is not active.

### No double runs

An occurrence is claimed in the database: one transaction moves the routine's next run on (only if no one else did) and inserts the run under a key unique per routine and occurrence. Two scheduler passes, a restarted host, or two host processes on one database can all see an occurrence due, and exactly one of them starts it. A thread started by a run is linked in the transaction that stores the thread. A run a host stopped during, before its work started, is marked failed at the next boot ("The host stopped before this run started its work") and is not retried.

## Caps and who may change routines

- **How often.** A routine runs at most every 15 minutes: a schedule whose closest two runs are nearer is refused, from the form, the API and the coordinator alike. The host owner can change this with the `routine_min_interval_minutes` setting (1 to 1440).
- **How many.** A project has at most 10 routines turned on (`routine_max_active_per_project`, 1 to 100). A paused routine does not count.
- **Owner only.** Creating, changing, deleting and running routines starts work on the host unattended, so these routes are the host owner's (`auth/route-policy.ts`), as are the two settings. A paired device sees the Routines tab read-only. The coordinator acts for the owner through its MCP tools, within the same caps.

## The coordinator and threads

The coordinator holds `routine_create`, `routine_list`, `routine_update`, `routine_pause`, `routine_delete` and `routine_run_now` ([MCP](./MCP.md)), so the person can ask in chat ("every weekday at 9, summarize new issues"). A thread holds `aop_propose_routine`: the proposal reaches the coordinator as a hidden message, and the coordinator asks the person before creating anything. A brief a coordinator routine sends shows in the chat as the person's message, labelled "Routine · <name>".

## HTTP

| Route | |
| --- | --- |
| `GET /api/projects/:id/routines` | The routines, oldest first, with `timeZone` and `limits` |
| `POST /api/projects/:id/routines` | Create (owner) |
| `GET`, `PATCH`, `DELETE /api/projects/:id/routines/:routineId` | Read; change (owner); delete with its history (owner) |
| `POST /api/projects/:id/routines/:routineId/run` | Run now (owner) |
| `GET /api/projects/:id/routines/:routineId/runs` | History, newest first |
| `POST /api/projects/:id/routines/preview` | A schedule in words, its next three runs on the host's clock, and why it would be refused |

Changes reach the project's event stream as `routine.upserted` and `routine.removed`, so every open dashboard updates.
