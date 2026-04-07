# DeFi Orchestrator MCP Server

## What This Is
An MCP server for multi-step DeFi strategy orchestration on Base/EVM. Simulate and execute compound DeFi strategies (swaps, lending, liquidity), compare DEX quotes, check portfolio positions, and discover yield opportunities — all with built-in safety rails.

## Quick Start
```bash
npm install
npm run build
node dist/index.js  # stdio mode
```

## Environment Variables
- `RPC_URL` — Override default RPC (optional, defaults to Base mainnet)
- `DEPLOYER_PRIVATE_KEY` — For executing strategies and swaps (optional)

## Architecture
```
src/
├── index.ts                 # Server entry — registers tools, starts stdio
├── services/
│   ├── protocols.ts         # Protocol configs (Uniswap V3, Aerodrome, Aave V3)
│   ├── simulator.ts         # Strategy simulation engine
│   └── strategies.ts        # Strategy parsing, step planning, execution
└── tools/
    ├── strategy-tools.ts    # defi_simulate_strategy, defi_execute_strategy, defi_quick_swap
    └── position-tools.ts    # defi_check_positions, defi_get_yields
```

## Tools (5 total)

### Free
| Tool | Description |
|------|-------------|
| `defi_simulate_strategy` | Simulate a multi-step DeFi strategy from natural language |
| `defi_check_positions` | Check all DeFi positions for a wallet (Aave, tokens, portfolio) |
| `defi_get_yields` | Discover top yield opportunities across DeFi protocols |

### Pro (requires API key)
| Tool | Description |
|------|-------------|
| `defi_execute_strategy` | Execute a previously simulated strategy on-chain |
| `defi_quick_swap` | Single token swap with best execution across DEXes |

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
