# Desktop app

The Electron app in `apps/desktop` is a thin client of an AOP host. It bundles the dashboard and serves it as `app://aop`; its own pages (`app://desktop`) connect to a host, show how the connection is, and, on a Mac, run the host on that Mac. Claude in Chrome cannot drive an Electron window, so this recipe has two halves: the cross-origin transport the app relies on, proved in Chrome, and the app itself, driven over the DevTools protocol with `scripts/desktop-cdp.ts`.

Everything that starts an agent needs a stack seeded with `--fake-runtime`, started with the tripwire stubs first on `PATH`. Never start a thread or send a message on a host that was not seeded that way: the desktop's host-mode host has no fake runtime.

## Sub-features

- `desktop-transport` opens the built dashboard from a second origin in Chrome, pointed at a host over its LAN address, and shows the token path works across origins.
- `desktop-connect` connects the app to a host with a pairing code and reaches the bundled dashboard.
- `desktop-notify` starts a thread that needs the person and reads the notification the app raised.
- `desktop-revoke` removes the device on the host and watches the app return to its status screen.
- `desktop-host-mode` runs the host on this Mac from the app, with the Tailscale command and a pairing code.

## Build and launch

```bash
bun run --filter @aop/desktop build          # vite build, bundles apps/dashboard/dist, bundles the Electron main process
```

The repo installs Electron without its binary. Unzip the cached one to a scratch folder, outside the repo (`ls ~/Library/Caches/electron/*/electron-v43.3.0-darwin-arm64.zip`), then start the app from `apps/desktop` with a scratch profile:

```bash
AOP_DESKTOP_LOG_STDOUT=1 AOP_DESKTOP_NOTIFY_WHEN_FOCUSED=1 AOP_LOG_DIR=<scratch>/logs \
  PATH=<tripwire dir>:$PATH <scratch>/Electron.app/Contents/MacOS/Electron . \
  --user-data-dir=<scratch>/userdata --remote-debugging-port=9333 --use-mock-keychain
```

- `--use-mock-keychain` keeps the run from writing an item into the login keychain. It exercises `safeStorage` with a mock key; it does not prove the real keychain.
- `AOP_DESKTOP_NOTIFY_WHEN_FOCUSED=1` makes the app raise notifications while its window is in front, which it otherwise suppresses.
- The app logs to `<AOP_LOG_DIR>/desktop.log` and, with `AOP_DESKTOP_LOG_STDOUT=1`, to the terminal: window titles, connection states, host process states, and each notification it would show.
- Without `AOP_DESKTOP_DEV_URL` the app runs the built screens exactly as a packaged app does. Quit it from the connect screen (`window.aopDesktop.quitApp()`) so the host it started is stopped; a plain `kill` does not run the quit path.
- Host mode is offered only when a server binary is found. Point `AOP_DESKTOP_HOST_PATH` at the dev wrapper that `scripts/desktop/dev-isolated-desktop.ts` writes (`writeDevHostWrapper`) and set `AOP_DESKTOP_LOCAL_SERVER_PORT`, `AOP_HOME` and `AOP_DB_PATH` to scratch values.

## Driving the window

`S=.claude/skills/verify/scripts`

```bash
bun $S/desktop-cdp.ts targets                      # the page's title and address
bun $S/desktop-cdp.ts shot <file.png>              # a real screenshot; read it before you trust it
bun $S/desktop-cdp.ts js '<expression>'            # click a button, read the DOM
bun $S/desktop-cdp.ts errors                       # reload and print console errors
```

The pages carry `data-testid` handles: `connect-{screen,url,code,device-name,submit,error,run-local,back,removed}`, `status-{screen,label,host-version,explanation,open-dashboard,retry,pair-again,change-host,disconnect}`, `host-{screen,status,error,start,stop,open-dashboard,open-logs,tailscale-toggle,tailscale-command,tailscale-steps,pairing-create,pairing-code,pairing-error,change}`. React inputs need the native value setter and an `input` event; `.value = ` alone does nothing.

## Recipes

- **Transport (`desktop-transport`).** Start a stack with `AOP_BIND_HOST=0.0.0.0 DASHBOARD_STATIC_PATH=$PWD/apps/dashboard/dist AOP_ALLOWED_ORIGINS=http://localhost:<port2>`, seed it, and serve `apps/dashboard/dist` from `<port2>` with any static server that falls back to `index.html`. Check `curl -i -X OPTIONS <lan>/api/projects -H 'Origin: app://aop' -H 'Access-Control-Request-Method: GET' -H 'Access-Control-Request-Headers: authorization'` answers `204` with `Access-Control-Allow-Origin: app://aop`, and the same with `Origin: https://evil.example` answers `403`. In a new Chrome tab open `http://localhost:<port2>/`, set `localStorage["aop:host:v1"]` to `{"baseUrl":"http://<lan-ip>:<port>","token":null}` and reload: the pairing screen appears, and a code from `POST <api>/api/auth/pairing-codes` pairs it. Start a thread on the host: its card appears with no reload and `project-stream-state` reads `Live`. In the tab, `new EventSource(streamUrl, {withCredentials: true})` ends `CLOSED` (the cookie is `SameSite=Strict`, so it never crosses origins) while `fetch(streamUrl, {headers: {Authorization: 'Bearer …'}})` answers `200 text/event-stream`. Revoke the device with `DELETE /api/auth/devices/<id>`: within seconds the pairing screen returns. The tool blocks any value that contains a token from being returned, so return strings.
- **Connect and reach the dashboard (`desktop-connect`).** A remote host must be `https://`, or `http://` on loopback. To test with a host that treats the app as a remote device rather than its owner, front the host with `bun $S/serve-proxy.ts --listen <port> --target <api url>` (a loopback proxy that adds `X-Forwarded-For` and `Tailscale-User-*`, what `tailscale serve` does) and connect to the proxy's `http://127.0.0.1:<port>`. On the connect screen fill `connect-url` and `connect-code` and click `connect-submit`: the window title becomes `AOP · Connected to 127.0.0.1:<port>`, `targets` shows `app://aop/`, the sidebar lists the host's projects, and `localStorage` is empty. `device-tokens.json` in the profile holds a base64 ciphertext and `grep -r 'aop_' <profile>` finds no token.
- **Notifications (`desktop-notify`).** With the app connected, `POST <api>/api/projects/<id>/threads` with `{"title":"Pick a region","prompt":"Choose [fake: ask=\"Which region?\" options=\"eu|us\"]"}`. `desktop.log` gains `notification {"kind":"needs-you","body":"Pick a region · Which region?"}` and one for the coordinator's post. Threads that were already waiting when the app connected raise nothing. `PATCH <api>/api/projects/<id>` with `{"notificationLevel":"off"}` silences the next thread. The operating system's banner is not observable this way; the log is the app's own record of what it asked the OS to show.
- **Revoke (`desktop-revoke`).** `DELETE <api>/api/auth/devices/<id>` while the dashboard is up: within one check interval (15 seconds) the window returns to `app://desktop/index.html#/status`, its title reads `… does not accept this device`, and `Pair again` opens the connect screen with the address filled in. Stop the proxy and relaunch with the same profile: the app opens the status screen (`Cannot reach …`) and moves to the dashboard by itself when the host is back.
- **Host mode (`desktop-host-mode`).** With a server binary available, the connect screen offers `connect-run-local`. Click it: the log shows `host process` go `starting` then `running`, the port listens on `127.0.0.1` only (`lsof -nP -iTCP:<port> -sTCP:LISTEN`), and `host-status` reads `Running on port <port>`. `host-tailscale-toggle` shows `tailscale serve --bg --https=443 http://127.0.0.1:<port>`, `host-pairing-create` shows a code, and `host-open-dashboard` opens the owner's own dashboard with no token (`connection-status` `connected`). Quitting the app stops the host it started; the port is free afterwards. Start a host by hand on the port first and the app adopts it (`ownership` `adopted`, no second server) and leaves it running when the app quits.

## Not covered

- The real keychain (`safeStorage` without `--use-mock-keychain`), the operating system's notification banner and a click on it, the application menu, and a packaged, signed build. These need a person at the Mac.
- `tailscale serve` itself. The proxy stands in for it; `docs/HOST.md` says how to check a real one.
