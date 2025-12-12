# GEMINI.md (Gemini CLI)

## Context

**Read `llms.txt` first** for project overview, repo layout, commands, and DAML coding standards.

## Notes

This is a **DAML-first** repository. When making changes:
- Validate inputs early (fail fast).
- Never allow empty `Text`.
- Keep array fields present (use `[]` for empty).
- Avoid trivial type aliases; prefer validators.

## Commands

- `npm run build`
- `npm run clean`
- `npm run test`
- `npm run codegen`
