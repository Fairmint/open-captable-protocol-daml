# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Context

**Read `llms.txt` first** for project context, DAML coding standards, and commands.

## Quick Reference

### After Any Change

```bash
npm run build && npm run test
```

### Key Patterns

- OCF schema → DAML types (field ordering matters)
- Issuer contract as factory for all objects
- Dual signatories: issuer + system operator
- Archive + recreate for edits (no direct mutation)
