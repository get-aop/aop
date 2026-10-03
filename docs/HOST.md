# Running the AOP host

The AOP host is the local server on the machine that keeps your projects, threads, and settings. Other computers reach it as clients. This guide covers setting up a host, how clients are authenticated, how to pair one, how to reach the host from another machine with `tailscale serve`, and how AOP updates.

## Set up a host

Install the host with one command ([README](../README.md#install-the-host)). The installer ends by naming the next steps: `aop pair` (`aop-nightly pair` on AOP Nightly) to pair another device, the `tailscale serve` command that publishes this host on your tailnet, and where updates and setup live.

AOP settings › Host shows what the host still needs, as a checklist. Its header reads like "Linux · AOP Nightly 0.10.8-nightly.20261002.17 · up 3 h · 5 of 6 ready". Until every check is ready, the home page shows the same checklist as a "Set up this host" card above **Start your first project**. **Hide setup** folds the card to one line. The Host item in AOP settings and the project switcher's AOP settings carry an amber dot while a check needs attention.

| Check | Ready when | When it is not |
| --- | --- | --- |
| Runs as a service | The launchd agent or systemd user unit from `install.sh` starts the host at boot and after an update. A host the Mac app runs, and a source checkout, count as ready. | **How to**: run `install.sh` once more, which registers the service. Projects, threads and settings stay, and running turns carry on through the restart. |
| Reachable from your other devices | `tailscale serve` publishes the host. The check lists the addresses, `https://` first. | **How to**: the `tailscale serve` command with this host's port ([Reach the host with Tailscale](#reach-the-host-with-tailscale)). |
| Claude Code | Claude Code is installed and logged in on the host. | **How to**: install it, or run `claude` on the host and use `/login`. It links to AOP settings › Runtimes. |
| GitHub | `gh` is signed in on the host. Every project's pull requests go through this login, so a paired device needs none. | **How to**: `gh auth login` on the host. |
| Computer use | CUA Driver is ready: the driver, the screen and the browser, and who holds computer use now. It links to the live view. | **Fix** runs `aop computer-use setup` on the host when it needs no password. When a step needs `sudo` or a macOS permission, it reads **How to** and shows the one command to run on the host. With no project using computer use, it reads "Not set up · optional" and does not count against the total. |
| Updates | Always ready. It names the channel and when the host installs updates. | It links to AOP settings › Updates. |

Every How to is written for whoever reads it, with the host's name, so a person on another device knows to run the command on the host. **Fix** is for whoever may manage the host ([Managing the host](#managing-the-host)); anyone else sees what is missing and why there is no button. After a fix, the checklist looks again by itself.

The API is `GET /api/host/setup` (any device; `?fresh=1` looks again instead of reusing the last few seconds) and `POST /api/host/setup/<id>/fix` (whoever may manage the host). The checks live in `apps/local-server/src/host-setup/`.

## Who can call the API

Every `/api/*` route needs credentials except the few a client must reach before it has any. A request is one of three things.

| Caller | How it identifies itself | Can do |
| --- | --- | --- |
| Host owner | Nothing. A request made directly on the host machine (see [The host owner](#the-host-owner)). | Everything. |
| Paired device | `Authorization: Bearer <token>`, or the `aop_device` cookie the host set for it. | Everything except the owner's guards. It manages the host too, unless the owner turned that off ([Managing the host](#managing-the-host)). |
| Anyone else | Nothing. | `GET /api/health`, `POST /api/auth/pair`, and `/api/mcp`, which checks its own per-session token. |

The owner's guards are what lower a guard on the host itself: who may manage the host (`host_management`), rotating the secret the AOP tools' tokens are signed with ([MCP](./MCP.md#loopback-authentication)), turning on Skip permission checks for its agents ([Runtimes](./RUNTIMES.md#skipping-permission-checks)), the caps on routines and setting routines up, a project's Linear key, acting on GitHub pull requests as the host's `gh` login, and choosing whether a project's threads may operate the host's desktop and browsers (computer use, see [Threads and git](./THREADS.md#computer-and-browser-use)). Only the host owner can do these. The list lives in `apps/local-server/src/auth/route-policy.ts`. A route that is not listed there is open to paired devices and closed to everyone else.

### Managing the host

Managing the host means updating the host and its agent CLIs, checking for and cancelling a host update, reading the update log, changing the update settings, making pairing codes, revoking devices, and running a setup Fix. The host setting `host_management` decides who may:

- `devices` (the default): the host owner and every paired device. This fits the everyday setup, an app on a laptop driving a host over Tailscale, where every request is a paired device's.
- `owner`: only requests made on the host machine.

Only the host owner changes it, in AOP settings › Updates › **Who can update this host**. Everyone else sees the choice read-only. It is a guard against mistakes, not a security boundary: a paired device can start a thread, and that thread's agent runs on the host, where it could call the API on loopback as the owner. With `devices`, a lost laptop can make pairing codes and revoke other devices until you revoke it; set `owner` if that matters more to you than updating from your laptop.

A request that may not manage the host gets `403` with code `HOST_ONLY` and the reason. The dashboard shows a viewer who may not act why there is no button, never just a missing one. `GET /api/updates` says whether the caller may update (`canUpdate`), so clients do not guess.

### Agents

A request the `aop` CLI makes inside an agent's turn is refused every owner and manager route, whoever it authenticates as: `403` with code `AGENT_REFUSED`. The host sets `AOP_CHAT_SESSION_ID` in every turn, and the CLI then sends the `x-aop-agent-session` header. `aop update` refuses to run inside a turn as well, because the restart would cut the turn it runs in (`aop update --check` still works). This keeps an agent from restarting the host it runs on, or widening its own rights, by accident. It is a guard, not a boundary: an agent that calls the API without the CLI is not caught.

### The host owner

The dashboard and the `aop` CLI running on the host need no pairing. A request counts as the host owner's when all of these hold:

1. The TCP peer is a loopback address.
2. The `Host` header names loopback: `localhost`, `aop.localhost`, `127.0.0.1`, or `::1`.
3. The request carries no header a reverse proxy adds when it forwards: `Forwarded`, `X-Forwarded-*`, `X-Real-IP`, `Via`, `CF-Connecting-IP`, `True-Client-IP`, or any `Tailscale-*` header.

Loopback alone is not enough. `tailscale serve`, Caddy, and every other reverse proxy connect to the server from `127.0.0.1` on behalf of remote clients, so a rule that trusted the socket would give the whole network owner access. Condition 2 rejects a proxy that forwards the client's `Host`, condition 3 rejects one that rewrites it, and each rule also stops a DNS-rebound web page.

A request that fails any condition is authenticated like any other remote request.

Browser requests must also come from the API's own origin. A page on another origin, including another local port, gets `403`. To allow more, list them in `AOP_ALLOWED_ORIGINS`.

## Pair a device

1. Get a one-time code. It works once and expires after ten minutes, and a new code replaces the one before it. Any of these makes one:

   - On the host, run `aop pair` (`aop-nightly pair` for AOP Nightly). It prints the code and the addresses to enter it at:

     ```text
     Pairing code: K7QM-4XNP (expires in 10 min)
     Enter it in the AOP app or a browser at https://soulf.tail1234.ts.net
     ```

     When the host is not reachable from other devices yet, it says so and prints the `tailscale serve` command.
   - In the dashboard, open AOP settings › Host › **Pair a device** and choose **Generate pairing code**. This works on the host and on any paired device that may manage the host ([Managing the host](#managing-the-host)).
   - From a program on the host:

     ```bash
     curl -s -X POST http://127.0.0.1:25150/api/auth/pairing-codes
     # {"code":"K7QM-4XNP","expiresAt":"..."}
     ```

     Use the port the host listens on: 25150 by default, 25650 for AOP Nightly.

2. On the new device, trade the code for a token. In the desktop app, choose **Another computer** on the connect screen, and enter the host's address and the code. In a browser, open the host's address: the dashboard shows a pairing screen, where you enter the code and a name for the device, and the cookie in the next paragraph is all it needs. From a program, use the host's address as the client sees it, such as the `tailscale serve` URL.

   ```bash
   curl -s -X POST https://mac.tail1234.ts.net/api/auth/pair \
     -H 'Content-Type: application/json' \
     -d '{"code":"K7QM-4XNP","name":"Work laptop"}'
   # {"device":{"id":"...","name":"Work laptop",...},"token":"aop_..."}
   ```

   The token appears in this response only. The host keeps a SHA-256 hash of it, so a lost token means pairing again. The same response sets the `aop_device` cookie, which is all a browser needs.

Five wrong codes in a minute lock pairing for the rest of that minute, including for the right code. The response is `429` with `Retry-After`.

### Use the token

- Programs send `Authorization: Bearer aop_...`.
- Browsers send the cookie automatically, which is how an `EventSource` authenticates: it cannot set headers. A client that holds a token and needs the cookie calls `POST /api/auth/session` with the bearer header.
- `GET /api/auth/me` reports who the host thinks you are.

The cookie is `HttpOnly` and `SameSite=Strict`, and it is `Secure` when the request came in over HTTPS.

### Clients served from another origin

The dashboard the host serves is same-origin and uses the cookie. A client served from anywhere else, such as the desktop app's bundled dashboard or a development build, authenticates differently, because the cookie cannot reach it:

- **Bearer token on every request.** The client sends `Authorization: Bearer aop_...`. A browser only lets a page from another origin do that if the host answers its preflight, so the host lists the origins it accepts. `app://aop`, the desktop app's origin, is always accepted: only the desktop app can produce it, since a web page cannot claim another scheme's origin. Add others with `AOP_ALLOWED_ORIGINS`. Any other origin gets `403` before it is looked at. An origin you list is trusted as far as you trust yourself: a page from it that runs in a browser on the host's own machine reads the API as the host owner, with no token.
- **Event streams with `fetch`.** An `EventSource` cannot set a header, and the session cookie is `SameSite=Strict`, so a browser never sends it across origins: an `EventSource` from another origin ends `CLOSED` at once. A client that holds a token reads the stream with `fetch` and the bearer header instead, and resumes with `?after=<last event id>` as it always does. No token goes in a URL, and the stream closes when the device is revoked, as any other does.
- **Version handshake.** `GET /api/health` reports `version`, `apiVersion` and `minClientApiVersion` without credentials, along with the `channel` and the `port` the host listens on. A client compares its own API version with them before it pairs and on every check afterwards: a client older than `minClientApiVersion` needs an app update, and one newer than `apiVersion` needs a host update. Raise `API_VERSION` in `packages/common/src/host-api.ts` for a change that would break a client one release behind.
- **Which app it is.** The desktop app names itself and its version in the `x-aop-client` header (`desktop; version=0.10.8; platform=darwin`). The host keeps it on the device's row, which is how AOP settings › Host shows each device's app and whether it is out of date. A browser sends none, and the host reads its platform from the User-Agent.

## The desktop app

The desktop app is a client of one host. It bundles the dashboard and serves it as `app://aop`; the host's own dashboard is not used.

- **First run.** The app opens on **Connect to a host**, with two choices. **This Mac** (macOS only) runs the host on this Mac; see [Run the host from the Mac app](#run-the-host-from-the-mac-app). **Another computer** asks for the host's address and a pairing code, with the computer's name prefilled behind **Name this computer**. The address must be `https://`, such as the one `tailscale serve` gives, because the app's pages are a secure context and the token would otherwise cross the network in the clear. The one exception is a host on the same computer, `http://127.0.0.1:<port>`. The app pairs with `POST /api/auth/pair`, from its main process. **Change Host…** in the Host menu opens the same screen later.
- **Pairing happens in the app.** The dashboard's own pairing screen never shows inside the app. When the host turns the device away, the dashboard hands over to the app's status screen, which offers **Pair again**.
- **Where the token lives.** In the operating system's keychain, through Electron's `safeStorage`: Keychain on macOS, DPAPI on Windows. The app writes the encrypted value to `device-tokens.json` in its data folder, mode `0600`, and refuses to pair on a machine where the keychain is unavailable. The dashboard receives the token in memory when it starts and never writes it to local storage.
- **Connection state.** The window title names the app and its host, such as "AOP Nightly · soulf". The Host menu and the app's own status screen say whether the host is connected, unreachable, refusing this device (`unauthorized`, for example after it was revoked on the host) or on another API version. The app checks every fifteen seconds, faster while the host is away. It brings its status screen forward when the host turns the device away, and returns to the dashboard on its own when the host comes back. **Change Host…** in the menu, or **Change host** on that screen, pairs with another host. **Disconnect** asks first, then removes the device from the host and forgets the token.
- **Menus.** The app menu (Help on Windows) has one update item, **Check for Updates…**, which looks now and opens the dashboard's Updates popover. Once a build is downloaded it reads **Restart to Update (x.y.z)**. The Host menu has the connection line, **Show Dashboard**, **Reconnect**, **Change Host…** and **Host Setup…**, which opens AOP settings › Host. About shows the app's version, and the host with its version.
- **Notifications.** The app's main process, not the dashboard, follows every active project's event stream with the token and raises an operating system notification when a coordinator posts, a thread needs the person, a thread fails, or a pull request merges or closes without merging. It runs in the main process because a notification is about any project, not the one on screen, must reach the person with the window closed, and needs the token that only the main process holds. Each project's notification level decides: `coordinator` (the default) is those events, `every-turn` adds each finished thread turn, and `off` is silence. It stays quiet while the app is in front, and it does not announce what happened more than two minutes earlier, so a laptop that wakes up does not bury the person in old news.
- **Updates.** See [This app](#this-app).
- **Host and app on different releases.** The Updates popover says it: the This app row reads "soulf runs 0.10.9; this app is older" when the host is newer, and the Host row reads "Older than this app" when the host is older. It is a notice only; the API version handshake still decides whether they can talk, and a real mismatch shows on the status screen.
- **Windows.** Windows is a client only. It bundles no server and has no host mode, and there is no Windows host, CLI or server build at all.
- **First launch.** The macOS app is signed with a Developer ID and notarized, so it opens without a warning. The Windows app is not signed yet, so SmartScreen says "Windows protected your PC" once: choose **More info**, then **Run anyway**. [Releasing](./RELEASE.md#signing) has the details.

### Run the host from the Mac app

On a Mac the app can be the host. Choose **This Mac** › **Set up this Mac** on the connect screen, or **Host on This Mac…** in the Host menu. The app starts the bundled `aop` server, watches it, and restarts it if it dies, up to three times. If an AOP host is already listening on the port, for example the background service the installer sets up, the app uses that one and leaves its lifetime alone: the host page offers no Stop button for it and shows the `launchctl unload ~/Library/LaunchAgents/com.aop.local-server.plist` command that stops the service. The server binds `127.0.0.1` whatever the app was started with, and quitting the app stops a server the app started.

The app's own dashboard is then the owner's direct-local case: no pairing, no token. To reach the host from other computers, turn on **Serve over Tailscale**. The app shows the `tailscale serve` command from [Reach the host with Tailscale](#reach-the-host-with-tailscale) with the host's port filled in, and you run it in Terminal; the app never runs it for you. **Pair another device** shows a one-time code.

A host the app runs comes with the app and updates with it. Its Host row in the Updates popover reads "Updates with this app", and Update host is never offered: the updater refuses to replace a binary inside an `.app` bundle.

### List and revoke devices

AOP settings › Host › **Paired devices** lists each paired device: its name, the app and version it runs (a browser uses the host's dashboard, so it is always current), its platform, and when it was last seen. The viewer's own device is marked **This device**. A desktop app older than the host on the same channel is marked **Out of date**. Every device sees the list. Whoever may manage the host ([Managing the host](#managing-the-host)) also gets **Revoke**, which removes a device after a question; anyone else sees the list read-only, with the reason. Or run these on the host.

```bash
curl -s http://127.0.0.1:25150/api/auth/devices
curl -s -X DELETE http://127.0.0.1:25150/api/auth/devices/<id>
```

Revoking takes effect on the device's next request, and the host closes any event stream the device already holds open. A device can also sign itself out with `DELETE /api/auth/session`, which revokes it.

## Updating AOP

Three things update: **This app** (the desktop app you are looking at), the **host**, and the **agent CLIs** on the host (Claude Code). The dashboard shows them in one place:

- **The Updates button.** An arrow at the right end of the top bar, shown only when something can be updated, an update is running, or one failed. It has a dot while there is news since you last opened it. Its popover has one row per thing: This app (desktop app only), Host <name>, and each agent CLI. Each row has its version, what is out, a status (Up to date, Update available, Downloading… 62%, Ready, Updating host…, Waiting for 2 turns, Update failed), one line on what happens, and the action. **Check for updates** looks at every feed now.
- **AOP settings › Updates.** The same rows with the details, and every update setting: the channel, the app's download, how the host installs updates, the agent CLIs, and who can update this host.
- **AOP settings › About.** The versions only: this app, the host, the channel and the host API.

In a browser there is no This app row: a browser gets its dashboard from the host, so it updates with the host.

### This app

The desktop apps update from the release feed on getaop.com ([Releasing](./RELEASE.md#desktop-app-updates)). The Windows app, and a macOS app signed with a Developer ID, download a new version in the background and install it when the app restarts or quits. The row then reads **Ready**, with **Restart to update**, and the app menu's item reads **Restart to Update (x.y.z)**. Restarting the app never touches turns, which run on the host.

- **Download updates automatically** (on this app's card in AOP settings › Updates; on by default) decides whether a found version downloads by itself. When it is off, the row offers **Download and restart**. The app keeps the choice in `desktop-config.json` in its data folder.
- The app looks at startup, every six hours, and when you choose **Check for updates** or **Check for Updates…**. A failed download, or a check you asked for that failed, shows as **Update failed** with **Try again**.
- A macOS app that is not Developer ID signed (an older ad-hoc signed install, or a development build) cannot update itself. Its row offers **Download**: download the new DMG, quit the app, and replace it in Applications.
- `AOP_DESKTOP_DISABLE_UPDATES=1` in the app's environment turns the check off.

### The host

An installed host (the `aop` binary from `install.sh`) updates itself from the release feed on getaop.com, `https://getaop.com/releases/latest.json`, which the release workflow publishes with every release ([Releasing](./RELEASE.md#the-release-feed)). AOP Nightly reads its own feed ([AOP Nightly](./NIGHTLY.md#updates)). The first release that can do this is 0.10.0; an older host has no `aop update` and updates once by running the installer again. AOP 0.10.0 to 0.10.4 read the repository's GitHub Releases instead, which answer 404 because the repository is private; see [Updating from 0.10.0 to 0.10.4](#updating-from-0100-to-0104).

Press **Update host** in the Updates popover or on AOP settings › Updates, on the host or on any paired device that may manage it. Or, in a terminal on the host:

```bash
aop update --check    # only report whether a newer release is published
aop update            # download, verify, install and restart
```

The update downloads the binary for this machine (an x64 host that runs through Rosetta on Apple silicon gets the arm64 build) and `runtime-assets.tar.gz`. It checks both against the sha256 the feed lists for them, the same digests as the release's `checksums.sha256` that `install.sh` checks. A file that does not match is deleted and the update stops with nothing changed. With background download on, the files are already downloaded, and they are checked again before use. It then runs the new binary once (`--version`) to see that it starts and is the release it claims to be. Only then does it replace the binary and the `dashboard` folder next to it, keeping the old ones aside, and restart the host the way it runs:

| How the host runs | Restart |
| --- | --- |
| launchd service from `install.sh` (macOS) | `launchctl unload`, then `launchctl load -w` of the same plist |
| systemd user service from `install.sh` (Linux) | `systemctl --user restart aop-local-server.service` (`aop-nightly-local-server.service` for Nightly) |
| `aop run --background` | stop the recorded process, then `aop run --background` again on the same port |
| `aop run` in a terminal, or installed with `--no-service` and not running | Nothing can restart it. The files are replaced, and the Host row reads **Installed, restart needed**: "Restart the host to use x.y.z: stop `aop run` and start it again". The Runs as a service check on AOP settings › Host shows how to install the service. |
| The Mac app's host | None: it updates with the app, and its row reads "Updates with this app". |
| A source checkout | None: its row reads "Runs from source". Pull and rebuild. |

A restart does not stop the agents at work. Chat and thread runs are detached processes: the old host ends at once on the restart's SIGTERM (the installed `aop run` has no graceful shutdown that would stop them, and the systemd unit has `KillMode=process`), the runs keep going, and the new host picks each one up where it is, as after a crash. Their chats stop updating for the few seconds the restart takes. A unit written by `install.sh` before 0.10.5 lacks `KillMode=process`, so on Linux run the installer once more to get it.

If the new host does not report the new version within a minute, or cannot be started, the old binary and dashboard are put back and started again, and the update reports why. The Host row then reads **Update failed**, with **Show log** (the end of `~/.aop/logs/update.log`) and **Try again**. The data folder (`~/.aop`) is never touched; database migrations run when the new host starts, as on any start. Only an `aop` that is the installed binary can update. One running from a source checkout, or one inside the Mac app, says so and does nothing.

AOP pins the CUA Driver version it was tested with, so a host update can bring a new driver, and the Host row says so ("Includes CUA Driver 0.32.0 → 0.33.0"). When the new host starts, it brings an installed driver that is older than the pin up to it, with the installer `aop computer-use setup` uses, without `sudo` or a prompt. The swap waits until no thread holds computer use, and holds the computer-use lease itself meanwhile, so threads that want the screen queue behind it. It never installs a driver nobody installed, and leaves a newer one alone. If the step fails, the host update still stands, and the Computer use check on AOP settings › Host says what to fix. `AOP_CUA_AUTO_UPGRADE=0` turns it off.

### Remote hosts

A host on another computer updates the same way, from any paired device that may manage it: press **Update host** in the desktop app or in a browser. No SSH is needed.

While the host updates, the Updates button reads **Updating host…** on every connected device, not only the one that started it. When the host answers on the new version, a browser reloads (its dashboard came from the old host) and shows "Host soulf updated to x.y.z" with Release notes. The desktop app reconnects without reloading, because its dashboard is bundled. If the host does not come back on the new version within three minutes, the row says so.

### Agent CLIs

The agent CLI rows show the version installed on the host and the newest one out. **Update** installs it with no restart: the next turn uses it. A native install updates at once. A package-manager install waits for the turns using it to finish, and the row reads "Waiting for 2 turns". [Runtimes](./RUNTIMES.md#keeping-the-agent-clis-up-to-date) has the details and the settings.

### Who may update

Updating the host and its agent CLIs, and changing the update settings, follow the `host_management` setting ([Managing the host](#managing-the-host)): by default the host and its paired devices may. A viewer who may not sees the updates and the settings, with the reason in place of the buttons: "Updates for this host can only be started on soulf itself (AOP settings › Updates › Who can update this host)." An agent never may ([Agents](#agents)).

### Update policies

These host settings are on AOP settings › Updates, except `update_check`. Whoever may manage the host changes them.

| Setting | Default | What it does |
| --- | --- | --- |
| `update_check` | `"true"` | Whether the host looks at the feed by itself. Stable looks once a day: about half a minute after it starts, then whenever the last look is a day old. Nightly looks every hour. The result is kept in `~/.aop/update-check.json`, so restarts do not ask again. When it is off, the host never contacts the feed by itself, nothing downloads or installs on its own, and Update host and `aop update` still work. Its switch is "Check for updates" on AOP settings › Updates. |
| `update_install` | `ask` on Stable, `idle` on Nightly | **Install host updates.** `ask` ("Ask me"): the Updates button shows the update and waits for a person. `idle` ("Automatically, when no turn is running"): the host installs once the turns running when it saw the build have finished. `window`: the same, but only between the `update_install_window` hours. |
| `update_install_window` | `01:00-06:00` | The hours of `window`, `HH:MM-HH:MM` on the host's clock. It may wrap past midnight. An install that is queued but not started when the window closes waits for the next one. |
| `update_background_download` | `"true"` | **Download updates in the background.** The newer release is downloaded and checked ahead of time into `~/.aop/update-staged/<version>/`, without changing the install, so Update host only has to swap and restart. A failed download is tried again an hour later. |
| `host_management` | `devices` | **Who can update this host.** See [Managing the host](#managing-the-host). Only the host owner changes it. |

The agent CLI settings, `agent_cli_auto_update` and `agent_cli_check_interval_minutes`, are on the same page ([Runtimes](./RUNTIMES.md#keeping-the-agent-clis-up-to-date)).

When a new build fails to start and is rolled back, the host waits six hours before it installs it by itself again. A release installed on a host started by hand is not installed again by itself; it waits for that host's restart. A person can still install either with Update host. A host that had the older `update_auto_apply` setting keeps its choice: `true` became `idle`, and `false` became `ask`.

### Turns running

A host update restarts the host. The turns keep running (the agents are separate processes, and the new host picks them up from their logs), but their chats stop updating for the few seconds the restart takes. So when turns are running, Update host asks first: "Update host soulf now?", naming the running turns and any thread using computer use.

- **Update now** restarts the host at once.
- **Update when they finish** queues the update on the host itself, so it still happens if you close the window. The Host row reads "Waiting for 2 turns", with **Update now** and **Cancel**. The host waits only for the turns that were running when you asked. New turns can still start, and they are not waited for, so a host that is never idle still updates. It installs at the first moment none of those turns is still running.
- A queued update never forces the restart. After six hours the row reads "Still waiting for 2 turns" and asks again, with Update now and Cancel. It still installs if those turns end first.

An automatic install (`idle` or `window`) queues the same way. It stops waiting if the setting changes to `ask` or the window closes.

`aop update` in a terminal does not ask: it installs at once.

### Where the host looks

The feed comes first. When it cannot be read and the host's environment holds a GitHub token (`AOP_GITHUB_TOKEN`, then `GH_TOKEN`, then `GITHUB_TOKEN`) that can read the private repository, the host reads the newest GitHub Release instead and downloads its files with the token, checking them against that release's `checksums.sha256`. The token goes to the GitHub API only, never to the storage GitHub redirects the download to. Without a token there is no fallback, and the check reports why the feed failed.

### Updating from 0.10.0 to 0.10.4

These releases read `https://api.github.com/repos/get-aop/aop-mono/releases/latest`, which answers 404, so they never see a newer release. Either:

- run the installer once more (`curl -fsSL https://getaop.com/install.sh | sh`); every release after that updates in the app; or
- point the running host at getaop.com, which also publishes the feed in the GitHub shape those releases read (at `/repos/get-aop/aop-mono/releases/latest`): add `AOP_GITHUB_API_URL=https://getaop.com` to the service's environment (the `EnvironmentVariables` dictionary of `~/Library/LaunchAgents/com.aop.local-server.plist`, then `launchctl unload` and `launchctl load -w` it; on Linux an `Environment=` line in `~/.config/systemd/user/aop-local-server.service`, then `systemctl --user daemon-reload` and a restart). **Update now** then works. Remove the line after the update; newer releases do not need it.

### The update API

| Call | Who | Does |
| --- | --- | --- |
| `GET /api/updates` | any device | The running release, the newest one seen and whether it is newer; the state of an update (`idle`, `updating`, `installed`, `failed`); how the host restarts; the running turns; a queued update; the background download; the previous update; and whether this caller may update (`canUpdate`). |
| `POST /api/updates/check` | whoever may manage the host | Looks at the feed now (at most every 30 seconds) and returns the same. |
| `POST /api/updates/apply` | whoever may manage the host | Starts the update. The body `{"when":"now"}`, or none, starts it at once; `{"when":"idle"}` queues it behind the turns running now. `202` with `queued` true or false. `409` with a reason when it cannot: already up to date, running from source or inside the Mac app, or one already running. |
| `DELETE /api/updates/apply` | whoever may manage the host | Cancels a queued update. `204`. |
| `GET /api/updates/log` | whoever may manage the host | The last 200 lines of the update log, and its path. |

## Reach the host with Tailscale

Keep the server on loopback and let `tailscale serve` terminate TLS in front of it. The tailnet then reaches the host over HTTPS with a certificate Tailscale provisions.

1. Install Tailscale on the host and on each client, and sign in to the same tailnet.
2. In the Tailscale admin console, enable MagicDNS and HTTPS certificates.
3. On the host, publish the local server. Stable AOP listens on 25150 and serves HTTPS on 443:

   ```bash
   tailscale serve --bg --https=443 http://127.0.0.1:25150
   tailscale serve status
   ```

   AOP Nightly listens on 25650 and serves HTTPS on that same port, so 443 stays free for a stable AOP on the same machine:

   ```bash
   tailscale serve --bg --https=25650 http://127.0.0.1:25650
   ```

   The Reachable from your other devices check on AOP settings › Host, `aop pair` and the installer's last lines show the right command for the host, with its port. If 443 already serves something else on the tailnet name, the check suggests the host's own port instead.

4. From a client, open `https://<host-name>.<tailnet>.ts.net` (Nightly: `https://<host-name>.<tailnet>.ts.net:25650`) and pair as above.
5. Check that the proxy did not become a way in. From a client that is not paired, this must return `401`:

   ```bash
   curl -i https://<host-name>.<tailnet>.ts.net/api/auth/me
   ```

   A `200` with `{"kind":"owner"}` means the proxy makes remote requests look local. Stop the proxy and do not use it until it forwards the client's `Host` or adds a forwarding header.

To stop publishing the host, run `tailscale serve reset`. Do not use `tailscale funnel` for the host: it puts the API on the public internet, where the only protection is a token.

Tailscale's documentation confirms that `tailscale serve` adds `Tailscale-User-Login`, `Tailscale-User-Name`, and `Tailscale-User-Profile-Pic` for tailnet traffic, which condition 3 above catches. It does not say whether the client's `Host` is preserved or whether `X-Forwarded-*` headers are added. Run the check in step 5 on your own setup.

If a browser is refused with `403: cross-origin requests are not allowed`, the proxy rewrote `Host` and sent no `X-Forwarded-Host`, so the page's origin no longer matches. Set the public origin explicitly:

```bash
AOP_ALLOWED_ORIGINS=https://<host-name>.<tailnet>.ts.net
```

### Other proxies

Caddy works when it forwards the client's `Host`, which it does by default, or when it adds `X-Forwarded-For`, which `reverse_proxy` also does by default:

```caddyfile
aop.example.com {
	reverse_proxy 127.0.0.1:25150
}
```

A proxy that rewrites `Host` to `127.0.0.1` and adds no forwarding header passes all three conditions, so its remote clients would be treated as the host owner. nginx's default `proxy_pass` does this. Add `proxy_set_header X-Forwarded-For $remote_addr;` or `proxy_set_header Host $host;`, then run the check in step 5.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `AOP_LOCAL_SERVER_PORT` | none, required | Port the server listens on. |
| `AOP_BIND_HOST` | `127.0.0.1` | Address the server listens on. Set `0.0.0.0` to serve the network directly over plain HTTP. |
| `AOP_ALLOWED_ORIGINS` | none | Comma-separated browser origins, besides the API's own and the desktop app's `app://aop`, that may call the API. |
| `AOP_RELEASE_FEED_URL` | `https://getaop.com` | The origin of the release feed the update check and `aop update` read (`/releases/latest.json`). Tests and trials point it at a fake feed. The desktop app reads the same variable. |
| `AOP_GITHUB_TOKEN` | none (`GH_TOKEN`, `GITHUB_TOKEN` also work) | A token that reads the private repository turns on the GitHub fallback when the feed cannot be read. |
| `AOP_GITHUB_API_URL` | `https://api.github.com` | The GitHub API the fallback reads. |
| `AOP_GITHUB_REPO` | `get-aop/aop` | The repository whose releases the fallback reads. |
| `AOP_PR_POLL_INTERVAL_MS` | none (adaptive) | Milliseconds between looks at an open pull request, for a fixed pace instead of the adaptive one. See [Threads and git](./THREADS.md#watching-the-pull-request). |

Prefer `tailscale serve` to `AOP_BIND_HOST`. A direct bind sends tokens over plain HTTP, so use it only on a network you trust, and the browser will not treat the page as a secure context. If you bind one specific non-loopback address, the host's own agents can no longer reach the MCP endpoint at `127.0.0.1`; set `AOP_MCP_URL` to an address they can reach.

## Limits

- Pairing codes and the wrong-code counter live in memory, so a host restart closes an open pairing.
- Paired devices are trusted equally. There are no per-device permissions: `host_management` lets all of them manage the host, or none.
- The `aop` CLI sends no token, so it works only on the host. It cannot reach a host across the network yet, so `aop pair` and `aop update` run on the host.
- The desktop app connects over HTTPS, or to a host on its own computer. A host bound to the network over plain HTTP is for browsers, which use the cookie.

## Computer use

Threads can operate the host's screen (browsers and desktop apps) through CUA Driver, which the install script sets up with `aop computer-use setup` (Nightly: `aop-nightly computer-use setup`). Run it again any time; `aop computer-use status` says what is missing.

- **Linux:** a virtual display by default (Xvfb + openbox as the user services `aop-xvfb` and `aop-openbox`, display `:99`, started at boot with linger), so threads never take over a desktop someone uses. Packages that need root (Xvfb, openbox, X libraries, AT-SPI, Google Chrome, ffmpeg) come as ONE `sudo sh -c '…'` command: setup runs it after asking when you are at a terminal, and only prints it otherwise. The chosen display is kept in `<AOP home>/computer-use.json`; the host reads it on every use, so no restart is needed.
- **macOS:** CuaDriver.app in /Applications. Grant Accessibility and Screen Recording to Cua Driver at the Mac; setup opens the dialogs only from a terminal and after asking.
- **One thread at a time:** the host holds a lease on the screen; other threads' CUA calls wait in line and go on by themselves. `GET /api/computer-use/lease` shows the holder and the line.
- **Setup and updates:** the Computer use check on AOP settings › Host says what is missing, with Fix or How to ([Set up a host](#set-up-a-host)). The driver's version is pinned with the host, and the host brings an older driver up to it when it starts ([The host](#the-host)).

Details, the lease rules and the limits: [Computer use](./architecture/computer-use.md).
