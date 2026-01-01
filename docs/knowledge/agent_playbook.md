---
title: Agent Playbook — Run, Debug, Fix
id: agent_playbook_run_debug
type: playbook
tags: [agent, playbook, debug, runbook]
---

# Agent Playbook — Run, Debug, Fix

Purpose: Provide prescriptive steps an AI agent should follow when asked to run, setup, debug, or fix a project.

## High-level policy
- Always confirm user intent before executing destructive actions.
- Prefer read-only actions (run tests, collect logs) first.
- When making changes, create a branch, run tests, and prepare a PR with a clear description.
- Roll back automatically on failed verification only when safe and reversible.

## Step-by-step flow
1. Clarify intent: ask minimal questions if prompt lacks context (target branch, reproduce steps).
2. Reproduce environment:
   - Ensure working directory is the repository root (for example, `{projectRoot}`).
   - Ensure environment variables (see `.env` or LLM config panel).
3. Run read-only checks:
   - `pnpm install` (if dependencies missing)
   - `pnpm test` to collect failing tests
   - `pnpm lint` / `pnpm typecheck` if available
4. Search KB for matching error signatures using the failing output.
5. If KB returns a recipe:
   - Present suggested plan to user (or proceed if agent profile permits).
   - Execute plan steps in order (commands + tool calls).
6. Verification:
   - Run specified verification commands from recipe (e.g., `pnpm test -- -u`).
   - If verification fails, run recipe rollback steps or revert branch.
7. Report back: Provide the user with an action summary, logs, diff, and PR link if created.

## Safety rules
- Do not modify secrets or commit keys.
- Ask before performing writes or pushing branches.
- Avoid accessing external networks without explicit permission.

## Example scenarios
- "Tests failing with X": Search KB for X, find `run-tests` recipe, run tests, collect stack traces, and propose fixes.
- "Add feature Y": Scaffold branch, run unit tests, update docs, prepare PR for review.

## Notes for implementers
- Recipes should include verification commands and rollback steps.
- Keep playbook small and authoritative — agents should use playbook as the primary policy text when composing system prompts for planning.
