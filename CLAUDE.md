# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
npm run test       # Run all tests in the Test package
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

## Architecture

This is a DAML implementation of the Open Cap Table (OCP) protocol for managing equity cap tables on-chain.

### Package Structure
- **OpenCapTable-v03/**: Core protocol implementation
  - Contains the main contracts and types for the OCP protocol
  - All modules are under `Fairmint.OpenCapTable` namespace
  
- **Test/**: Test suite
  - Contains test modules and integration tests
  - Depends on the OpenCapTable-v03 package and Splice integration

### Core Contracts
1. **OcpFactory**: System-level contract for authorizing issuers
2. **IssuerAuthorization**: Represents authorization for an issuer to operate
3. **Issuer**: Represents a company/issuer with their cap table
4. **StockClass**: Represents different classes of stock (common, preferred, etc.)
5. **StockPosition**: Represents individual stock holdings

### Key Types
- **OcfTypes**: Core OCF (Open Cap Table Format) type definitions
- **OcfObjects**: Complex OCF data structures (issuer data, stock class data)
- **OpenCapTableTypes**: Protocol-specific types

### Testing Pattern
Tests use DAML Script and follow this pattern:
1. Setup users (system_operator, issuer, investors)
2. Create contracts through the OcpFactory
3. Test happy paths and error cases
4. Use `assertMsg` for test assertions
5. Use `submitMultiMustFail` for testing expected failures

### Dependencies
- DAML SDK 3.3.0 (snapshot version)
- Splice integration library for blockchain interoperability