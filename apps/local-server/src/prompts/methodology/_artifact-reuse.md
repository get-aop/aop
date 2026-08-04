# Artifact Reuse

Before planning, scan the conversation and attached documents for a completed `plan.md`, including prior planning output, pasted markdown, and attached files.

- If a complete plan is present, skip re-planning. Pass its content through verbatim as `planMarkdown`; strip only wrappers such as code fences. Preserve the supplied structure and decisions, and note the reuse provenance in the task description.
- If the plan is partial, reuse all supplied content and plan only the gaps. Never re-open or re-litigate a decision already made in the conversation.
- If no plan is present, run the methodology unchanged.
- Legacy artifacts: when the conversation supplies completed `prd.md` and `issues.md` content instead, combine them verbatim into `planMarkdown`: the prd.md content first, then the issues.md content under a `## Issues` heading.
