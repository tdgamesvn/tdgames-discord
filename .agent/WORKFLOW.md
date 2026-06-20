# AGENT WORKFLOW — tdgames-discord

## Mandatory Read Order
1. `.agent/meta/PROJECT.md`
2. `.agent/meta/TASKS.md`
3. `.agent/meta/DECISIONS.md`
4. `.agent/WORKFLOW.md`

## Execution Rules
- Work only within the tdgames-discord project scope
- Keep changes minimal, reversible, and reviewable
- If starting a task from To do, move it to Doing first
- Only work on one main task at a time unless explicitly instructed
- Do not guess infra/secrets/runtime details; inspect and document them
- Ask before integrating external services (Discord token, Supabase keys, etc.)

## Update Rules
After each meaningful work session, update:
- `.agent/meta/TASKS.md`
- `.agent/meta/LOG.md`

If a durable technical decision is made, update:
- `.agent/meta/DECISIONS.md`

## Reporting Format
Each report should include:
1. Task name
2. Files changed
3. Summary of work
4. Validation performed
5. Risks / next steps

## Safety Rules
- No production deploys without approval
- No secret/token changes
- No destructive operations without approval
- Target scale: 5–10 concurrent users — keep architecture simple
- Do not over-engineer; prefer simplicity over premature optimization
