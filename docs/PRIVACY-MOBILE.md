# Privacy policy: AOP for iPhone and Android

*Effective 7 October 2026.*

AOP for iPhone and AOP for Android ("the app") are remote controls for AOP, software that you run on your own computer (your "host"). This policy explains what the app does with your information.

## In short

The app talks to the host you pair it with. On Android it also loads people's pictures from the services that host them (see below). It sends nothing to the AOP developers. It has no accounts, no analytics, no advertising and no tracking.

## What the app keeps on your phone

- **Your host's address and the name you gave this phone.** These are kept in the app's own storage.
- **The device token your host gave the app when you paired.** This lets the app sign in to your host. On iPhone it is kept in the Keychain, for this device only. On Android it is encrypted with a key held in the phone's Android Keystore. It is never included in backups.
- **Your notification settings and the last screen you had open.**

Deleting the app, or choosing **Disconnect this phone** in its settings, removes them. On iPhone, iOS keeps Keychain items after an app is deleted; if you install the app again, it deletes the old token the first time it opens.

## What the app sends, and where

- **To your host only:** your messages to the coordinator and to threads, your answers to their questions, and requests to read your projects, threads and conversations. The host is your own computer, reached over your own network, such as Tailscale. The AOP developers never receive any of it.
- **People's pictures (Android only):** beside pull requests and issues, the Android app shows the pictures GitHub, Linear and Jira give for the people involved. It loads them directly from those services' picture servers: `avatars.githubusercontent.com` (GitHub), `public.linear.app` (Linear), `avatar-management--avatars.us-west-2.prod.public.atl-paas.net` (Jira) and `secure.gravatar.com` (Gravatar, which Jira uses). Like any web request, this tells those servers your phone's network address and which picture it asked for. The app loads pictures from no other address and follows no redirects. The iPhone app shows initials instead and loads no pictures.
- **The camera** is used only to read the pairing QR code your host shows. No picture is kept or sent.
- **Notifications** are created on your phone from what your host reports. If push notifications are added later, your host will send them through Apple's or Google's push service. Those services then carry the alert's text, such as a thread's title and its question. This policy will be updated before that happens.

## Demo mode

**Try the demo** runs a pretend host inside the app. Nothing you type there leaves your phone.

## Children

The app is a tool for software developers and is not directed at children.

## Changes and contact

Changes to this policy are published at this address, with a new effective date. For questions, open an issue at <https://github.com/get-aop/aop/issues>.
