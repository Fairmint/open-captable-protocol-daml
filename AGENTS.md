# AGENTS.md (OpenAI Codex)

## Context

**Read `llms.txt` first**. It is the single source of truth for project context, structure, and DAML coding standards.

## What this repo is

A multi-package **DAML** codebase implementing the Open Cap Table (OCP) protocol, plus related packages (reports, proof-of-ownership, Canton payments) and TypeScript scripts for packaging/deployment.

## Commands

- `npm run build` — build all DAML packages
- `npm run test` — run DAML tests in `Test/`
- `npm run codegen` — generate JS bindings + bundle

## Coding rules (high level)

- Follow DAML standards in `llms.txt` (validate inputs; non-empty `Text`; arrays always present; no trivial type aliases; consistent choice ordering).
- Keep changes minimal and consistent with existing patterns.

## Documentation structure

- `llms.txt` — AI context
- `docs/developer/adr/` — architecture decisions (when needed)
- `tasks/` — task-driven development artifacts
