
# Improve Codebase Architecture

Use this skill to perform a narrow architecture improvement pass on the current worktree changes.

This repo-local version is execution-friendly. It does not open GitHub issues, create follow-up tasks, or depend on user interaction.

## Checklist

1. Read repo guidance and the current task docs
2. Inspect the current worktree diff and the touched modules in full
3. Identify 1-3 high-confidence architecture improvements that stay inside the current task scope
4. Apply only the smallest worthwhile improvement set
5. Run the smallest relevant verification commands for the changed code

## Architecture Heuristics

Look for improvements like:

- A concept spread across too many tiny helpers or files
- Callers that know too much about another module's internals
- Shallow abstractions where the interface is almost as noisy as the implementation
- Test setups that are hard because behavior is split across seams instead of hidden behind one boundary
- Duplicate orchestration logic that should live in one deeper module

Prefer improvements that:

- Make the public path easier to understand
- Hide complexity behind a smaller boundary
- Reduce coupling between adjacent modules
- Improve testability through public behavior rather than test-only helpers

## Guardrails

- Keep the pass narrow and local to the current change
- Do not add features or broaden product scope
- Do not create new abstractions unless they clearly simplify the existing design
- Do not create GitHub issues, task docs, or follow-up planning artifacts
- If no clear improvement is available, stop after confirming the current structure is good enough

## Output

Leave the worktree ready for final review, with any architecture improvements verified locally.
