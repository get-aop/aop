# Running the AOP host

The AOP host is the local server on the machine that keeps your projects, threads, and settings. Other computers reach it as clients. This guide covers how clients are authenticated, how to pair one, and how to reach the host from another machine with `tailscale serve`.

## Who can call the API

Every `/api/*` route needs credentials except the few a client must reach before it has any. A request is one of three things.

| Caller | How it identifies itself | Can do |
| --- | --- | --- |
| Host owner | Nothing. A request made directly on the host machine (see [The host owner](#the-host-owner)). | Everything, including administering the host. |
| Paired device | `Authorization: Bearer <token>`, or the `aop_device` cookie the host set for it. | Everything except administering the host. |
| Anyone else | Nothing. | `GET /api/health`, `POST /api/auth/pair`, and `/api/mcp`, which checks its own per-session token. |

Administering the host means pairing devices, listing and revoking them, starting an update of the host itself or of an agent CLI, rotating the secret the AOP tools' tokens are signed with ([MCP](./MCP.md#loopback-authentication)), turning on Skip permission checks for its agents ([Runtimes](./RUNTIMES.md#skipping-permission-checks)), and choosing whether a project's threads may operate the host's desktop and browsers (computer use, see [Threads and git](./THREADS.md#computer-and-browser-use)). Only the host owner can do these, so a stolen laptop cannot mint itself a new token or remove the owner's other devices. The list lives in `apps/local-server/src/auth/route-policy.ts`. A route that is not listed there is open to paired devices and closed to everyone else.

### The host owner

The dashboard and the `aop` CLI running on the host need no pairing. A request counts as the host owner's when all of these hold:

1. The TCP peer is a loopback address.
2. The `Host` header names loopback: `localhost`, `aop.localhost`, `127.0.0.1`, or `::1`.
3. The request carries no header a reverse proxy adds when it forwards: `Forwarded`, `X-Forwarded-*`, `X-Real-IP`, `Via`, `CF-Connecting-IP`, `True-Client-IP`, or any `Tailscale-*` header.

Loopback alone is not enough. `tailscale serve`, Caddy, and every other reverse proxy connect to the server from `127.0.0.1` on behalf of remote clients, so a rule that trusted the socket would give the whole network owner access. Condition 2 rejects a proxy that forwards the client's `Host`, condition 3 rejects one that rewrites it, and each rule also stops a DNS-rebound web page.

A request that fails any condition is authenticated like any other remote request.

Browser requests must also come from the API's own origin. A page on another origin, including another local port, gets `403`. To allow more, list them in `AOP_ALLOWED_ORIGINS`.

## Pair a device

Pairing needs the host owner, so run the first command on the host.

1. On the host, ask for a one-time code. It works once and expires after ten minutes. Asking again replaces it. In the dashboard on the host, open Settings, then Devices, and choose Generate pairing code: the code appears with a countdown. Or from a terminal:

   ```bash
   curl -s -X POST http://127.0.0.1:25150/api/auth/pairing-codes
   # {"code":"K7QM-4XNP","expiresAt":"..."}
   ```

   Use the port the host listens on: 25150 by default, 25650 for AOP Nightly. The pairing screen on the new device shows this command with the host's own port, which it reads from `GET /api/health`.

2. On the new device, trade the code for a token. In a browser, open the host's address: the dashboard shows a pairing screen, where you enter the code and a name for the device, and the cookie in the next paragraph is all it needs. From a program, use the host's address as the client sees it, such as the `tailscale serve` URL.

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

## The desktop app

The desktop app is a client of one host. It bundles the dashboard and serves it as `app://aop`; the host's own dashboard is not used.

- **First run.** The app asks for the host's address and a pairing code. The address must be `https://`, such as the one `tailscale serve` gives, because the app's pages are a secure context and the token would otherwise cross the network in the clear. The one exception is a host on the same computer, `http://127.0.0.1:<port>`. The app pairs with `POST /api/auth/pair`, from its main process.
- **Where the token lives.** In the operating system's keychain, through Electron's `safeStorage`: Keychain on macOS, DPAPI on Windows. The app writes the encrypted value to `device-tokens.json` in its data folder, mode `0600`, and refuses to pair on a machine where the keychain is unavailable. The dashboard receives the token in memory when it starts and never writes it to local storage.
- **Connection state.** The window title, the Host menu and the app's own status screen say whether the host is connected, unreachable, refusing this device (`unauthorized`, for example after it was revoked on the host) or on another API version. The app checks every fifteen seconds, faster while the host is away. It brings its status screen forward when the host turns the device away, and returns to the dashboard on its own when the host comes back. **Change Host** in the menu, or on that screen, pairs with another host; **Disconnect** removes the device from the host and forgets the token.
- **Notifications.** The app's main process, not the dashboard, follows every active project's event stream with the token and raises an operating system notification when a coordinator posts, a thread needs the person, a thread fails, or a pull request merges or closes without merging. It runs in the main process because a notification is about any project, not the one on screen, must reach the person with the window closed, and needs the token that only the main process holds. Each project's notification level decides: `coordinator` (the default) is those events, `every-turn` adds each finished thread turn, and `off` is silence. It stays quiet while the app is in front, and it does not announce what happened more than two minutes earlier, so a laptop that wakes up does not bury the person in old news.
- **Updates.** The apps update from the release feed on getaop.com (the repository is private, so its GitHub Releases cannot be read). The Windows app downloads new versions in the background and installs them when you restart it. A signed macOS app does the same. One installed from an unsigned DMG shows "Update available (x.y.z)" in its window title and a menu with a link to the new DMG instead ([Releasing](./RELEASE.md#desktop-app-updates)). Set `AOP_DESKTOP_DISABLE_UPDATES=1` in the app's environment to turn the check off.
- **Host and app on different releases.** The status screen, the Host menu and the window title say when the host is newer than the app (update the app) or older (run `aop update` on the host). It is a notice only; the API version handshake still decides whether they can talk.
- **Windows.** Windows is a client only. It bundles no server and has no host mode, and there is no Windows host, CLI or server build at all.
- **First launch, unsigned builds.** The builds are not signed yet, so the operating system warns once. On macOS, Gatekeeper says the app cannot be verified: right-click `AOP.app`, choose **Open**, or allow it under System Settings, Privacy & Security, **Open Anyway** (`xattr -dr com.apple.quarantine /Applications/AOP.app` clears the download flag). On Windows, SmartScreen says "Windows protected your PC": choose **More info**, then **Run anyway**. [Releasing](./RELEASE.md#signing-is-off) says how signing gets turned on.

### Run the host from the Mac app

On a Mac the app can be the host. Choose **Run AOP on this Mac** on the connect screen, or **Host on This Mac** in the Host menu. The app starts the bundled `aop` server, watches it, and restarts it if it dies, up to three times. If an AOP host is already listening on the port, for example the background service the installer sets up, the app uses that one and leaves its lifetime alone: the host page offers no Stop button for it and shows the `launchctl unload ~/Library/LaunchAgents/com.aop.local-server.plist` command that stops the service. The server binds `127.0.0.1` whatever the app was started with, and quitting the app stops a server the app started.

The app's own dashboard is then the owner's direct-local case: no pairing, no token. To reach the host from other computers, turn on **Serve over Tailscale**. The app shows the `tailscale serve` command from [Reach the host with Tailscale](#reach-the-host-with-tailscale) with the host's port filled in, and you run it in Terminal; the app never runs it for you. **Pair another device** shows a one-time code, which only the host's own Mac can make.

### List and revoke devices

In the dashboard on the host, Settings, then Devices lists each paired device with when it was last seen and when it was paired, and Revoke removes one after a question. The entry is shown only to the host owner: a paired device does not see it, and its requests to these routes answer `403`. Or run these on the host.

```bash
curl -s http://127.0.0.1:25150/api/auth/devices
curl -s -X DELETE http://127.0.0.1:25150/api/auth/devices/<id>
```

Revoking takes effect on the device's next request, and the host closes any event stream the device already holds open. A device can also sign itself out with `DELETE /api/auth/session`, which revokes it.

## Updating the host

An installed host (the `aop` binary from `install.sh`) updates itself from the release feed on getaop.com, `https://getaop.com/releases/latest.json`, which the release workflow publishes with every release ([Releasing](./RELEASE.md#the-release-feed)). The first release that can do this is 0.10.0; an older host has no `aop update` and updates once by running the installer again. AOP 0.10.0 to 0.10.4 read the repository's GitHub Releases instead, which answer 404 because the repository is private; see [Updating from 0.10.0 to 0.10.4](#updating-from-0100-to-0104).

```bash
aop update --check    # only report whether a newer release is published
aop update            # download, verify, install and restart
```

`aop update` downloads the binary for this machine (an x64 host that runs through Rosetta on Apple silicon gets the arm64 build) and `runtime-assets.tar.gz`, and checks both against the sha256 the feed lists for them, the same digests as the release's `checksums.sha256` that `install.sh` checks. A file that does not match is deleted and the update stops with nothing changed. It then runs the new binary once (`--version`) to see that it starts and is the release it claims to be. Only then does it replace the binary and the `dashboard` folder next to it, keeping the old ones aside, and restart the host the way it runs:

| How the host runs | Restart |
| --- | --- |
| launchd service from `install.sh` (macOS) | `launchctl unload`, then `launchctl load -w` of the same plist |
| systemd user service from `install.sh` (Linux) | `systemctl --user restart aop-local-server.service` |
| `aop run --background` | stop the recorded process, then `aop run --background` again on the same port |
| `aop run` in a terminal, or installed with `--no-service` and not running | nothing can restart it: the files are replaced and `aop update` says to restart it yourself |

A restart does not stop the agents at work. Chat and thread runs are detached processes: the old host ends at once on the restart's SIGTERM (the installed `aop run` has no graceful shutdown that would stop them, and the systemd unit has `KillMode=process`), the runs keep going, and the new host picks each one up where it is, as after a crash. A unit written by `install.sh` before 0.10.5 lacks `KillMode=process`, so on Linux run the installer once more to get it.

If the new host does not report the new version within a minute, or cannot be started, the old binary and dashboard are put back and started again, and the update reports why. The data folder (`~/.aop`) is never touched; database migrations run when the new host starts, as on any start. Only an `aop` that is the installed binary can update: one running from a source checkout says so and does nothing.

### The notice in the dashboard

The host looks for a newer release once a day, about half a minute after it starts and then whenever the last look is a day old, and keeps the result in `~/.aop/update-check.json`, so restarts do not ask again. The dashboard shows a quiet "Update available (x.y.z)" bar with a link to the release notes to every signed-in client. On the host itself, the owner also gets **Update now**: it starts `aop update` in a separate process, the page shows that it is updating, and it reloads on its own once the host answers on the new version. A paired device sees the notice but no button, and `POST /api/updates/apply` answers `403` to it. If an update fails, the bar says why and offers Retry; the log of the run is `~/.aop/logs/update.log`.

To turn the check off, switch off **Check for updates** in Settings (the `update_check` setting, `"true"` by default). The host then never contacts the feed by itself; `aop update` still works when you run it. Nothing installs an update on its own: the setting only looks, and **Update now** or `aop update` installs.

### Where the host looks

The feed comes first. When it cannot be read and the host's environment holds a GitHub token (`AOP_GITHUB_TOKEN`, then `GH_TOKEN`, then `GITHUB_TOKEN`) that can read the private repository, the host reads the newest GitHub Release instead and downloads its files with the token, checking them against that release's `checksums.sha256`. The token goes to the GitHub API only, never to the storage GitHub redirects the download to. Without a token there is no fallback, and the check reports why the feed failed.

### Updating from 0.10.0 to 0.10.4

These releases read `https://api.github.com/repos/get-aop/aop-mono/releases/latest`, which answers 404, so they never see a newer release. Either:

- run the installer once more (`curl -fsSL https://getaop.com/install.sh | sh`); every release after that updates in the app; or
- point the running host at getaop.com, which also publishes the feed in the GitHub shape those releases read (at `/repos/get-aop/aop-mono/releases/latest`): add `AOP_GITHUB_API_URL=https://getaop.com` to the service's environment (the `EnvironmentVariables` dictionary of `~/Library/LaunchAgents/com.aop.local-server.plist`, then `launchctl unload` and `launchctl load -w` it; on Linux an `Environment=` line in `~/.config/systemd/user/aop-local-server.service`, then `systemctl --user daemon-reload` and a restart). **Update now** then works. Remove the line after the update; newer releases do not need it.

The API:

| Call | Who | Does |
| --- | --- | --- |
| `GET /api/updates` | host owner, paired device | The running release, the newest one seen, whether it is newer, and the state of a running update. |
| `POST /api/updates/check` | host owner, paired device | Looks at the feed now (at most every 30 seconds) and returns the same. |
| `POST /api/updates/apply` | host owner only | Starts the update. `202` when it started, `409` with a reason when it cannot (already up to date, running from source, one already running). |

## Reach the host with Tailscale

Keep the server on loopback and let `tailscale serve` terminate TLS in front of it. The tailnet then reaches the host over HTTPS with a certificate Tailscale provisions.

1. Install Tailscale on the host and on each client, and sign in to the same tailnet.
2. In the Tailscale admin console, enable MagicDNS and HTTPS certificates.
3. On the host, publish the local server. The default port is 25150.

   ```bash
   tailscale serve --bg --https=443 http://127.0.0.1:25150
   tailscale serve status
   ```

4. From a client, open `https://<host-name>.<tailnet>.ts.net` and pair as above.
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
- Paired devices are trusted equally. There are no per-device permissions.
- The `aop` CLI sends no token, so it works only on the host. It cannot reach a host across the network yet.
- The desktop app connects over HTTPS, or to a host on its own computer. A host bound to the network over plain HTTP is for browsers, which use the cookie.

## Computer use

Threads can operate the host's screen (browsers and desktop apps) through CUA Driver, which the install script sets up with `aop computer-use setup` (Nightly: `aop-nightly computer-use setup`). Run it again any time; `aop computer-use status` says what is missing.

- **Linux:** a virtual display by default (Xvfb + openbox as the user services `aop-xvfb` and `aop-openbox`, display `:99`, started at boot with linger), so threads never take over a desktop someone uses. Packages that need root (Xvfb, openbox, X libraries, AT-SPI, Google Chrome, ffmpeg) come as ONE `sudo sh -c '…'` command: setup runs it after asking when you are at a terminal, and only prints it otherwise. The chosen display is kept in `<AOP home>/computer-use.json`; the host reads it on every use, so no restart is needed.
- **macOS:** CuaDriver.app in /Applications. Grant Accessibility and Screen Recording to Cua Driver at the Mac; setup opens the dialogs only from a terminal and after asking.
- **One thread at a time:** the host holds a lease on the screen; other threads' CUA calls wait in line and go on by themselves. `GET /api/computer-use/lease` shows the holder and the line.

Details, the lease rules and the limits: [Computer use](./architecture/computer-use.md).

