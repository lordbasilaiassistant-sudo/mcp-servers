# Multi-Wallet MCP Server

## What This Is
An MCP server that gives AI agents multi-wallet management capabilities on Base and EVM chains. Generate wallet pools, check balances across wallets, distribute ETH, consolidate funds, scan token security, and monitor gas prices.

## Quick Start
```bash
npm install
npm run build
node dist/index.js  # stdio mode
```

## Environment Variables
- `RPC_URL` — Override default RPC (optional, defaults to Base mainnet)
- `DEPLOYER_PRIVATE_KEY` — For write operations like distributing ETH (optional)

## Architecture
```
src/
├── index.ts                 # Server entry — registers tools, starts stdio
├── constants.ts             # Chain configs, ABIs, well-known tokens
├── services/
│   ├── provider.ts          # Cached ethers providers per chain
│   └── wallet-store.ts      # In-memory wallet storage (keys never exposed)
└── tools/
    ├── wallet-tools.ts      # wallet_generate, wallet_import, wallet_list, wallet_get_balances, wallet_get_all_balances
    ├── distribution-tools.ts # wallet_distribute_eth, wallet_consolidate_eth
    └── analysis-tools.ts    # wallet_scan_token, wallet_get_gas, wallet_get_token_balance
```

## Tools (10 total)

### Read-only (no key needed)
| Tool | Description |
|------|-------------|
| `wallet_list` | List all managed wallets |
| `wallet_get_balances` | ETH + token balances for one wallet |
| `wallet_get_all_balances` | ETH balances for entire wallet pool |
| `wallet_get_token_balance` | Check any ERC-20 token balance |
| `wallet_scan_token` | Security scan a token contract |
| `wallet_get_gas` | Current gas prices on chain |

### Write (requires DEPLOYER_PRIVATE_KEY or imported wallet)
| Tool | Description |
|------|-------------|
| `wallet_generate` | Generate N new wallets (1-100) |
| `wallet_import` | Import wallet by private key |
| `wallet_distribute_eth` | Send ETH to multiple wallets |
| `wallet_consolidate_eth` | Sweep ETH back to one address |

### Safety
- Write operations require `confirm: true` parameter
- Private keys are NEVER returned via MCP tools
- All write tools return simulation results when `confirm: false`

## Build Commands
```bash
npm run build    # Compile TypeScript
npm run dev      # Watch mode with tsx
npm run lint     # Type check
npm test         # Run vitest
```

## Adding a New Tool
1. Create or edit a file in `src/tools/`
2. Use `server.tool(name, description, zodSchema, handler)` pattern
3. Return via `mcpResult()` helper — always structured JSON
4. Register in `src/index.ts` with the appropriate `register*Tools(server)` call
5. Include `explorerUrl` in responses for on-chain entities

## Supported Chains
- Base (8453) — default
- Ethereum (1)
- Arbitrum One (42161)

## Publishing
```bash
npm run build
npm publish --access public
```

Register on MCP marketplaces using the `server.json` manifest.
