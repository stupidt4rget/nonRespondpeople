# AGENTS.md

Guidance for OpenCode sessions in this repo.

## Status
Early workspace. No package.json, tsconfig.json, or test runner is wired up yet.
Do NOT assume npm run / test / typecheck scripts exist. Verify before invoking.

## Stack
- Intended: Node.js + TypeScript.
- Build outputs: dist/ and build/ are gitignored.
- Local persistence: data/, *.db, and *.sqlite are gitignored.
- Secrets/config via .env and .env.local are gitignored. Never commit secrets.

## Layout
- docs/devlog.md - development journal. Append notes here.
- docs/todo.md - task backlog.
- README.md - project overview. Currently empty.

## Workflow
- Work on feature branches.
- Merge via PR.
- No direct commits to main after setup.
- When TypeScript tooling lands, run lint, typecheck, and test before review.
- Exact commands are TBD until package.json scripts exist.

## Agent Rules
- Do not invent scripts that are not present in package.json.
- Do not install new dependencies without approval.
- Do not modify unrelated files.
- Do not commit .env, API keys, local databases, or generated build outputs.
- Prefer small, reviewable changes.
