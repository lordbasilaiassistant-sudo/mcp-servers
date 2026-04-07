# Gas Paymaster MCP Server

## What This Is
An MCP server for gas credit management and sponsored transactions via The Agent Cafe paymaster on Base mainnet. Check gas tank levels, estimate costs, optimize batch transactions with Multicall3, and send paymaster-sponsored transactions.

## Quick Start
```bash
npm install
npm run build
node dist/index.js  # stdio mode
```

## Environment Variables
- `RPC_URL` — Override default RPC (optional, defaults to Base mainnet)
- `DEPLOYER_PRIVATE_KEY` — For sending sponsored transactions (optional)

## Architecture
```
src/
├── index.ts                 # Server entry — registers tools, starts stdio
├── services/
│   ├── gas-oracle.ts        # Gas price fetching, history, trend analysis
│   └── paymaster.ts         # Agent Cafe paymaster integration, tank checks
└── tools/
    ├── gas-tools.ts         # gas_check_tank, gas_estimate, gas_price_history
    └── tx-tools.ts          # gas_optimize_batch, gas_send_sponsored
```

## Tools (5 total)

### Free
| Tool | Description |
|------|-------------|
| `gas_check_tank` | Check gas credit balance in The Agent Cafe paymaster |
| `gas_estimate` | Estimate gas cost for a transaction at slow/standard/fast speeds |
| `gas_price_history` | Gas price trends with cheapest time windows |

### Pro (requires API key)
| Tool | Description |
|------|-------------|
| `gas_optimize_batch` | Analyze batch transactions for Multicall3 optimization |
| `gas_send_sponsored` | Send a paymaster-sponsored transaction |

## Build Commands
```bash
npm run build    # Compile TypeScript
npm run dev      # Watch mode with tsx
npm run lint     # Type check
npm test         # Run vitest
```

## Supported Chains
- Base (8453) — default (sponsored txs only on Base)
- Ethereum (1) — estimates only
- Arbitrum One (42161) — estimates only
