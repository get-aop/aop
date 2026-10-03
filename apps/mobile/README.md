# @aop/mobile

The AOP Android app (iOS later). Native Kotlin with Jetpack Compose and Material 3, built with Gradle, not Bun. User guide: [docs/MOBILE.md](../../docs/MOBILE.md).

```
shared/        Kotlin Multiplatform core, shared with the future iOS app: wire types, the host's HTTP API,
               the project event stream (SSE), the session state, and the notification policy.
androidApp/    The Android app: Compose screens, the adaptive list-detail layout, the token store,
               the background connection service and notifications.
wire-fixtures/ JSON samples of the host's wire types. wire-contract.test.ts parses them with the zod
               schemas in @aop/common (bun test); the Kotlin tests decode the same files.
scripts/       gradle.ts, which `bun run typecheck` and friends call.
```

## Tooling

JDK 17 and the Android SDK (platform 37, build-tools 36). `scripts/gradle.ts` finds them through `JAVA_HOME` / `ANDROID_HOME` (or `~/.local/share/jdk/jdk-17` and `~/.local/share/android-sdk`); without them, `bun run typecheck` skips this workspace locally and fails in CI.

```bash
bun run --filter @aop/mobile typecheck      # compile shared + app
bun run --filter @aop/mobile test:android   # Kotlin unit tests
bun run --filter @aop/mobile lint:android   # Android lint
bun run --filter @aop/mobile apk            # signed release APK in androidApp/build/outputs/apk/release
bun test apps/mobile                        # wire contract against @aop/common
```

## Release signing

The release key never enters the repository. The build reads a properties file (`storeFile`, `storePassword`, `keyAlias`, `keyPassword`) from `AOP_MOBILE_SIGNING_PROPERTIES`, else `~/.aop-mobile/keystore.properties`. Without it, `assembleRelease` produces an unsigned APK that Android refuses to install. Keep the key: an update signed with another key cannot be installed over the old app.

## Layout rules

- Size classes, never device names. Two panes from 600 dp wide (`calculatePaneScaffoldDirectiveWithTwoPanesOnMediumWidth`): a Galaxy Z Fold8's inner screen held upright is about 704 dp. Half-folded, panes meet at the hinge instead of straddling it.
- Folding, unfolding, rotating and split-screen resizing are configuration changes, not activity restarts (`android:configChanges` in the manifest), so state and drafts survive them. `MainScreen` applies the navigator's recomputed pane layout on resize, which the adaptive library otherwise defers to the next navigation.
- Edge-to-edge and predictive back are on (target SDK 36). Target 37 waits until Android 17's local-network permission is tested against Tailscale addresses.

## Testing on emulators

Device profiles that match the Galaxy Z Fold8 (inner 1848×2448 at 420 dpi): an emulator with that screen and `adb shell wm size 1248x1972` for the cover screen (and `wm size reset` to unfold) drives a live fold. Point the app at a development host with `http://10.0.2.2:<port>` (plain HTTP is allowed only to the emulator's host alias and loopback). Use a host started with `--fake-runtime` (`.claude/skills/verify`) so no real model runs.
