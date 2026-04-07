# Contract Scanner MCP Server

## What This Is
An MCP server that gives AI agents smart contract security scanning capabilities. Analyzes Solidity contracts for vulnerabilities BEFORE interacting with them — detects reentrancy, hidden mints, backdoors, proxy risks, access control issues, and more.

## Quick Start
```bash
npm install
npm run build
node dist/index.js  # stdio mode
```

## Environment Variables
- `RPC_URL` — Override default RPC (optional, defaults to Base mainnet)
- `BASESCAN_API_KEY` — For fetching verified source from Basescan (optional, enables source analysis)
- `ETHERSCAN_API_KEY` — For fetching verified source from Etherscan (optional)
- `ARBISCAN_API_KEY` — For fetching verified source from Arbiscan (optional)

Without API keys, tools still work using bytecode-only analysis.

## Architecture
```
src/
├── index.ts                 # Server entry — registers tools, starts stdio
├── tools/
│   ├── scan-tools.ts        # scanner_analyze_contract, scanner_compare_contracts
│   └── lookup-tools.ts      # scanner_check_address, scanner_decode_calldata
└── services/
    ├── analyzer.ts          # Core analysis engine (source + bytecode)
    ├── patterns.ts          # 20+ vulnerability patterns (SWC registry based)
    └── provider.ts          # Chain configs, cached ethers providers
```

## Tools (4 total)

### Premium (rate limited on free tier)
| Tool | Description |
|------|-------------|
| `scanner_analyze_contract` | Full security report — fetches source, analyzes bytecode, returns risk score 0-100 with findings |
| `scanner_compare_contracts` | Compare two contracts side-by-side — clone detection, risk comparison |

### Free
| Tool | Description |
|------|-------------|
| `scanner_check_address` | Quick check — contract vs EOA, verification status, risk flags |
| `scanner_decode_calldata` | Decode raw tx calldata to human-readable function calls |

## Design Principles
1. ONE tool call = complete analysis. No setup, no pagination, no follow-up.
2. Every response includes `explorerUrl`, `suggestion`, `related_tools`.
3. Works without API keys (bytecode-only). Source analysis needs explorer API key.
4. All 20+ vulnerability patterns based on SWC registry and real audit findings.
5. Tool descriptions written for AI agents — describe WHEN to use, not just WHAT.

## Vulnerability Categories
- Reentrancy (SWC-107)
- Integer overflow (SWC-101, pre-0.8.0)
- Unchecked return values (SWC-100)
- Access control (SWC-105, SWC-115)
- Delegatecall risks (SWC-112)
- Selfdestruct (SWC-106)
- Token risks: hidden mint, blacklist, pause, fee-on-transfer
- Proxy/upgradeable patterns
- Hardcoded address backdoors
- Timestamp manipulation (SWC-116)

## Build Commands
```bash
npm run build    # Compile TypeScript
npm run dev      # Watch mode with tsx
npm run lint     # Type check
npm test         # Run vitest
```

## Supported Chains
- Base (8453) — default
- Ethereum (1)
- Arbitrum One (42161)
