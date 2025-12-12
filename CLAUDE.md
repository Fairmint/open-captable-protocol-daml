# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Context

**Read `llms.txt` first** for project overview, repo layout, and DAML coding standards.

## Commands

### Build
```bash
npm run build      # Build all DAML packages
daml build --all   # Alternative: build all packages directly
```

### Clean
```bash
npm run clean      # Clean all build artifacts
daml clean --all   # Alternative: clean directly
```

### Test
```bash
npm run test          # Run all tests in the Test package
cd Test && daml test  # Alternative: run tests directly
```

To run a single test module:
```bash
cd Test && daml test --test-filter TestCreateIssuer
```

### Code Generation
```bash
npm run codegen    # Generate JavaScript bindings from DAML
```

## Architecture (minimal)

This is a DAML implementation of the Open Cap Table (OCP) protocol, plus related packages (reports, proof-of-ownership, Canton payments).

For details and coding standards, prefer `llms.txt`.
