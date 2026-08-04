---
name: Pull request
about: Describe the change you're proposing
title: ""
labels: ""
assignees: ""
---

## Summary

What this PR does, in one or two sentences.

## Problem / motivation

Link to the issue or describe the problem this solves.

## Changes

- Bullet list of the concrete changes.

## Verification

List the exact commands you ran and their results (per repository policy):

```bash
bun test <affected files>
bunx biome check <touched files>
bun run --filter <workspace> typecheck
```

Note explicitly if the full repository gate was not run and why.

## Notes for reviewers

Anything reviewers should know: risky areas, follow-up work, decisions made.
