# Third-Party Notices

This repository's source code is licensed under the MIT License (see
`LICENSE`). This file documents vendored, copied, or embedded third-party
material. For each upstream that MIT requires attribution for, the full MIT
License text and the exact copyright line are reproduced below, together with
the affected paths in this repository.

---

## T3 Code (Sessions UI presentation)

AOP's Sessions interface — chat composer, timeline, sidebar, and panel
presentation — includes code copied and adapted from T3 Code.

- Upstream repository: `https://github.com/pingdotgg/t3code`
- Pinned upstream revision: T3 Code `apps/web` circa March 2026 (the historical
  `apps/dashboard/src/t3/ui/` copy and its derivatives)
- Upstream license: MIT, `Copyright (c) 2026 T3 Tools Inc.`
- Affected paths (derived files in HEAD):
  - `apps/dashboard/src/views/sessions/ChatComposer.tsx`
  - `apps/dashboard/src/views/sessions/ChatTimelineRows.tsx`
  - `apps/dashboard/src/views/sessions/ChatWorkLog.tsx`
  - `apps/dashboard/src/views/sessions/SessionChangedFilesCard.tsx`
  - `apps/dashboard/src/views/sessions/changed-files-tree.ts`
  - `apps/dashboard/src/views/sessions/composer-icons.tsx`
  - `apps/dashboard/src/views/sessions/sessions-page-git.tsx`
  - `apps/dashboard/src/views/sessions/sessions-page-view.tsx`
  - Historical copies of the same presentation live under
    `apps/dashboard/src/t3/` in earlier revisions of this repository; this
    notice covers those revisions as well.

MIT License

Copyright (c) 2026 T3 Tools Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

## shadcn/ui

AOP's dashboard UI primitives are built on components from shadcn/ui. The
project is declared in `apps/dashboard/components.json`; most files under
`apps/dashboard/src/ui/` carry the shadcn v4 `data-slot` component signature,
and several are substantially verbatim from upstream.

- Upstream repository: `https://github.com/shadcn-ui/ui`
- Upstream license: MIT, `Copyright (c) 2023 shadcn`
- Affected paths:
  - `apps/dashboard/src/ui/` (all components derived from shadcn/ui)
  - `apps/dashboard/src/lib/cn.ts`
  - `apps/dashboard/src/hooks/use-mobile.ts`
  - `apps/dashboard/src/hooks/use-media-query.ts`

MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

## Superpowers (workflow methodology)

AOP bundles workflow methodology markdown under
`apps/local-server/src/prompts/methodology/` so execution does not depend on
globally installed agent skills. Two of these files are copied verbatim from
Superpowers (upstream frontmatter removed); the rest are adapted or AOP-written.

- Upstream repository: `https://github.com/obra/superpowers`
- Pinned upstream revision: `469a6d81`
- Upstream license: MIT, `Copyright (c) 2025 Jesse Vincent`
- Affected paths (verbatim copies):
  - `apps/local-server/src/prompts/methodology/systematic-debugging.md`
  - `apps/local-server/src/prompts/methodology/test-driven-development.md`

MIT License

Copyright (c) 2025 Jesse Vincent

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

## Fonts

The dashboard bundle ships two fonts via `@fontsource`, both under the SIL
Open Font License 1.1:

- **Inter** — `https://rsms.me/inter/`, Copyright (c) 2016-2023 The Inter
  Project Authors. Licensed under SIL OFL-1.1.
- **Geist Mono** — `https://vercel.com/font`, Copyright (c) 2023 Vercel, Inc.
  Licensed under SIL OFL-1.1.

SIL Open Font License 1.1 is reproduced at
`https://openfontlicense.org/open-font-license-official-text/`; the font files
are distributed unmodified under their own OFL-1.1 license terms.

---

## npm dependencies

The following bundled or notable dependencies have licenses that differ from
the repo's MIT default:

- **dompurify** — Apache-2.0 (this project elects Apache-2.0 for it, per its
  upstream `LICENSE`).
- **lightningcss** — MPL-2.0 (build-time only; not shipped in runtime bundles).
- **khroma** — MIT upstream, but the published npm tarball omits the license
  field; provenance recorded here as MIT.

The complete dependency license inventory is generated by the repository's
license audit tooling; all direct runtime dependencies are permissive
(MIT/ISC/Apache-2.0/BSD).

---

## Provider logos

`apps/dashboard/src/ui/provider-icon.tsx` embeds raw SVG paths for third-party
brand marks (OpenAI, Anthropic, xAI, and others). These marks are the property
of their respective owners and are used here solely to identify the supported
runtimes in the UI.

---

## Packaged runtime assets

The open-source tree ships the CLI, local server, and dashboard. Operators may
deploy `apps/license-server` separately (e.g. on Railway) for Lemon Squeezy
license activation; that service is MIT-licensed code in this repo, not a
vendored third-party binary.

If future release bundles add packaged icons, fonts, or other non-code assets,
document their source URL and applicable license in this file before
distribution.
