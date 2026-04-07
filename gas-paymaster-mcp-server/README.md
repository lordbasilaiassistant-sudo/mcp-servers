# @thryx/gas-paymaster-mcp-server

Gas credit management and sponsored transactions for AI agents via The Agent Cafe paymaster on Base mainnet.

## Installation

```bash
npm install @thryx/gas-paymaster-mcp-server
```

## Setup

Add to your MCP client config:

```json
{
  "mcpServers": {
    "gas-paymaster": {
      "command": "npx",
      "args": ["@thryx/gas-paymaster-mcp-server"],
      "env": {
        "THRYX_API_KEY": "your-api-key"
      }
    }
  }
}
```

## Tools

| Tool | Description | Tier |
|------|-------------|------|
| `gas_check_tank` | Check gas credit balance, estimated txs remaining, and tank health | Free |
| `gas_estimate` | Estimate gas cost for a transaction at slow/standard/fast speeds | Free |
| `gas_price_history` | Gas price trends for the last N hours with cheapest time windows | Free |
| `gas_optimize_batch` | Analyze batch transactions for Multicall3 optimization and savings | Pro |
| `gas_send_sponsored` | Send a paymaster-sponsored transaction (dry-run by default) | Pro |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `RPC_URL` | No | RPC endpoint (default: Base mainnet) |
| `DEPLOYER_PRIVATE_KEY` | No | For sending sponsored transactions |
| `THRYX_API_KEY` | No | Premium API key for unlimited access |

## Supported Chains

- Base (8453) — default (sponsored txs only on Base)
- Ethereum (1) — estimates only
- Arbitrum One (42161) — estimates only

## License

MIT
