# AOP on your phone

The AOP Android app is a client of your AOP host, like the desktop app: pair it once with a code, and it shows your projects, the coordinator chat, every thread, and the questions threads are waiting on you to answer. It notifies you when a thread needs you, a run fails, or a pull request is ready, merged or closed. It never runs agents itself.

It is built for phones of every size, including foldables such as the Galaxy Z Fold8: on the cover screen it shows one thing at a time, and unfolded it shows the list on the left and the conversation on the right. Folding or unfolding keeps what you were reading and what you were typing. An iPhone app is planned; the app's core (`apps/mobile/shared`) is written to be shared with it.

## Install

The app is not on Google Play. Each release attaches a signed `aop-mobile-<version>.apk`.

1. On the phone, open the APK (download it from the release page, or from the AOP project's Library).
2. Android asks to allow installs from that app (your browser or Files). Allow it once.
3. Install, then open AOP.

Android may say the app is from an unknown developer. Google's developer verification only applies to apps from certain app stores in 2026, so installing the APK directly is unaffected.

## Pair

The phone reaches the host over [Tailscale](./HOST.md#reach-the-host-with-tailscale): install the Tailscale app on the phone and sign in to the same tailnet as the host.

1. Get a pairing code: in AOP on your computer, open AOP settings › Host › **Pair a device** and choose **Generate pairing code** (the code is shown with a QR code), or run `aop pair` on the host. See [Pair a device](./HOST.md#pair-a-device) for who may make one.
2. In the app, scan the QR code, or type the host's address (the `tailscale serve` URL, such as `https://my-host.my-tailnet.ts.net:25150`) and the code.
3. Name the phone and choose **Connect**. Allow notifications when Android asks.

The phone appears in the host's device list. **Disconnect this phone** in the app's settings removes it from the host; revoking it on the host signs it out, and the app asks to pair again.

If the app says **Can't reach the host. Is Tailscale on?**, turn on Tailscale on the phone and check that the host machine is awake and AOP is running there. The app keeps retrying.

## Notifications

Notifications need no Google or Firebase account. While **Stay connected** is on (the default), the app keeps one connection to the host open in the background, which Android shows as a quiet "Connected to …" notification, and it notifies you itself. Turning it off saves battery; you then see news when you open the app.

- What notifies you is set per kind in the app's settings: a thread needs you (on), a run failed (on), pull requests (on), coordinator replies (off). Each project's own notification level, set in AOP on your computer, still applies.
- A notification goes away once its thread is dealt with anywhere: answered on the phone, or opened on your computer.
- Nothing is shown while the app is open on screen.
- Samsung phones put apps they think are unused to sleep, which stops notifications. The app's settings offer **Let AOP run in the background** to prevent it.

## What a phone may do

A paired phone is a paired device, with the same rights as the desktop app on another computer: it can read and write chats, answer threads and change project settings. Whether it may also look after the host (update it, pair or remove devices) follows the host's setting ([Managing the host](./HOST.md#managing-the-host)); owner-only settings such as computer use stay on the host. The device token is encrypted with a key held in the phone's Android Keystore and is never backed up or copied to a new phone.

## Build it yourself

See [apps/mobile/README.md](../apps/mobile/README.md).
