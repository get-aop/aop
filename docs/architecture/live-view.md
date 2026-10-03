# The live view of the host's screen

While a thread uses computer use, a viewer who is not at the host can watch it. The dashboard shows the host's screen in a small floating window (picture in picture) that opens full screen on a click. This guide covers when the view shows, how the host knows a thread is using the screen, how frames are captured and travel, and what the dashboard does with them.

**View only.** Nothing a viewer does reaches the host's screen: no mouse, no keyboard, no clipboard. The host captures the screen and serves pictures of it, and has no route that takes input for it.

## When it shows

The host setting `live_view` (AOP settings › General › Computer use, or `PUT /api/settings/live_view`) decides who gets the view:

| Value | Who sees it |
| --- | --- |
| `off` | No one. The host refuses frames to everyone and never captures. |
| `remote` (the default) | Only a viewer on another machine than the host: a paired device, such as the desktop app connected to a remote host, or the dashboard opened from another computer. |
| `always` | Every viewer, the person at the host included. |

"Another machine" is the host's own call, the same one that decides who the host owner is (`auth/local-request.ts`): a request made directly on the host machine is the owner's, and everything else is a paired device's. `liveViewShownTo(mode, viewer)` in `@aop/common` is the rule; the host enforces it on every frame request, and the dashboard follows the host's `shown` answer.

When the setting allows it, the view shows while a thread is using CUA and goes away about ten seconds after that ends. If several threads use CUA at once, the most recently active one shows, and a switcher in the header picks another. Today all threads drive the host's one display, so every choice shows the same picture under a different title; the switcher matters once each thread gets its own display.

## How the host knows a thread uses CUA

From the thread's own tool calls. Every line a thread's Claude Code writes to its run log already passes through the host (the log tail that streams the turn), and `computer-use/cua-activity.ts` hears each assistant message that calls a `mcp__cua-driver__*` tool. Nothing else counts: not the project's computer use setting, and not the old CUA lock directory. A thread whose call waits in line for the computer-use lease ([Computer use](./computer-use.md#one-thread-at-a-time)) is left out of the sessions until its turn comes; the status's `lease` names the holder and the line.

- A thread's CUA session starts with its first CUA call.
- It ends when the thread calls `end_session`, when its turn ends (CUA Driver's MCP server ends with the run), or after three minutes without a CUA call (the thread moved on to a test suite and never said so).
- An ended session stays listed, marked `ending`, for ten seconds, so the viewer sees its last frame before the view goes away.

The tracker lives in memory. A turn the host recovers after a restart is not heard again, so a CUA session that was running when the host restarted shows again only from the thread's next turn.

## Capture

The host captures only while both hold: a CUA session is active, and a viewer has asked for a frame in the last five seconds. The first frame request starts the capture; the capture stops five seconds after the last request, or as soon as no CUA session is active, whichever comes first. One capture serves every viewer.

**Linux (X11).** The host runs ffmpeg's `x11grab` on the X display its runs get (`DISPLAY` in the environment threads are spawned with, so the display CUA Driver drives: on an AOP host on a server, typically an Xvfb). ffmpeg grabs 4 frames a second, scales anything wider than 1280 pixels down to 1280, and writes JPEGs (`-f mpjpeg`) that the host splits by their length headers. A frame identical to the one before it keeps its id, so an unchanged screen costs a viewer a `304`.

**macOS and Windows.** Not supported yet. The view shows "Live view unavailable: capturing the screen is not supported on macOS yet." A later version can capture through CUA Driver itself, which holds the Screen Recording grant on a Mac.

**Dependency.** ffmpeg must be on the PATH the host spawns runs with (`apt install ffmpeg`, or CUA Driver's `install_ffmpeg` tool). Without it, or without a display, the view says why instead of a picture: "Live view unavailable: ffmpeg is not installed on the host.", "…the host has no X display (DISPLAY is not set)." or "…the X display :99 is not running." (a local display is checked by its socket in `/tmp/.X11-unix`, since ffmpeg crashes on a missing one). If ffmpeg exits later (the display went away), the view says so with the last line ffmpeg printed. The host tries again at most every 15 seconds, not on every poll.

## Transport

Two routes under the existing authenticated API, in `computer-use/routes.ts`:

| Route | Answers |
| --- | --- |
| `GET /api/computer-use/live` | `LiveViewStatus`: the mode, who the caller is (`owner` or `device`), whether it gets the view (`shown`), the threads using CUA (most recent first) and the capture's state (`idle`, `starting`, `live` or `unavailable` with a reason). |
| `GET /api/computer-use/live/frame` | The latest frame as `image/jpeg` with an `ETag`; `304` when the caller's `If-None-Match` names it. Refusals are JSON with a code: `403 LIVE_VIEW_OFF`, `404 LIVE_VIEW_IDLE`, `503 LIVE_VIEW_STARTING`, `503 LIVE_VIEW_UNAVAILABLE`. |

**Who may call them.** Any authenticated caller: the host owner or a paired device. Not owner-only: the paired device is who the view is for (the person watching from their laptop while the host runs elsewhere), and a device already reads every thread's work, including the screenshots CUA tools return. Nothing is reachable without the session cookie or a device token, there is no new port, and the `live_view` setting turns frames off for everyone. A revoked device's next request is refused like any other.

**Polling, not a stream.** The view asks for one frame at a time with short requests, instead of holding a stream open. A browser keeps at most six HTTP/1.1 connections to one host, and the project streams already take up to four of them (`projects/watch-set.ts`); a short request gives its connection back after a few milliseconds, so the live view never takes one for itself. The pace adapts: up to four frames a second while the picture changes and the link keeps up (never faster than twice the last request took), slowing to one a second while the host answers "unchanged". The status is read every three seconds while the page is visible. Both stop when the view closes, the page is hidden or the viewer leaves, and the host's lease then lapses on its own. The host does not log these requests, as it does not log health checks.

**Desktop app.** Its Content-Security-Policy (`apps/desktop/electron/app-protocol.ts`) needs nothing new: frames are fetched from the host like any API call (`connect-src` names the host) and shown as `blob:` URLs (`img-src` allows `blob:`). Fetching them, instead of pointing an `<img>` at the route, is also what lets the desktop app send its device token as a header.

## In the dashboard

`apps/dashboard/src/live-view/`. The shell mounts the view once, over every screen.

- **The popup.** A small window with a header (a red live dot, the thread's title linking to the thread, the switcher when several threads use CUA, Minimize and Close) over the picture. It is about 288 pixels wide, narrower on a narrow window (168 at 400 CSS pixels), and as tall as the screen's aspect ratio makes it.
- **Moving it.** Drag it by any part but the header's buttons. Let go, and it snaps to the nearest corner of the window; the corner is remembered (local storage), and its place is worked out from the corner on every resize, so it never ends up outside the window. It starts top right, below the top bar and below the two header rows (breadcrumb and toolbar) of a pull request or an artifact shown in the chat's column: clear of the composers' send buttons at the bottom and of every header's controls, over the threads panel's list or the content of the PR View, an artifact or the AOP Browser.
- **Full screen.** A click on the picture (a press that did not move: a press that moved is a drag) opens it full screen over the app, as large as fits with its aspect ratio kept. "Picture in picture" or Escape turns it back into the popup; following the thread's link does too.
- **Minimize and close.** Minimize folds it to its header and stops fetching frames. Close hides it for this tab's session; while it is closed and a thread uses CUA, the top bar shows a "Live view" button that brings it back.

## Code

| Part | Where |
| --- | --- |
| Shared types and the who-sees-it rule | `packages/common/src/live-view.ts` |
| Hearing CUA calls in run logs | `apps/local-server/src/computer-use/cua-activity.ts`, wired in `chat-session/runtime-engine.ts` |
| ffmpeg capture and the `mpjpeg` splitter | `apps/local-server/src/computer-use/screen-capture.ts`, `mpjpeg.ts` |
| Lease, capture lifecycle, refusals | `apps/local-server/src/computer-use/live-view.ts` |
| Routes | `apps/local-server/src/computer-use/routes.ts` |
| Popup, full screen, store, frame polling, placement | `apps/dashboard/src/live-view/` |
| The setting | `live_view` in `apps/local-server/src/settings/types.ts` |

To try it without a model, a thread on the fake CLI can script CUA calls: `[fake: tools="mcp__cua-driver__click|mcp__cua-driver__click|mcp__cua-driver__end_session" delay=5000]` (see `packages/llm-provider/test-fixtures/README.md`).
