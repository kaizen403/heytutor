# Session ownership

Several agents share this repo. A silent edit in the scene-engine live path
has already cost optics scenes and overflowed the planner prompt. Announce
before you touch the shared seams; keep other sessions able to stay green.

## Announce before editing

Say so in the session before changing any of:

- `packages/scene-engine/src/synthesize/**`
- `packages/scene-engine/src/document/**`
- `packages/scene-engine/src/capability/**`
- `packages/scene-engine/scripts/verify/**`

Done when the session log names the path before the first edit.

## Keep other gates independent

A verify script owned by another session stays green on their layer alone.
Do not add an assertion there that only your layer can satisfy.

Done when every new check lives in a verify script this session owns, or is
an optional `--report` / measure script, not a shared gate.

## Secrets

A Cloudflare account token pasted into a chat is rolled by deleting that
token in the dashboard or via `DELETE /accounts/{account_id}/tokens/{id}`.
Checking that it still works does not close the leak. Never write a live
token into the repo, `remaining.md`, or a commit message.
