# @thryx/defi-orchestrator-mcp-server

Multi-step DeFi strategy orchestration for AI agents on Base/EVM. Simulate and execute compound strategies with built-in safety rails.

## Installation

```bash
npm install @thryx/defi-orchestrator-mcp-server
```

## Setup

Add to your MCP client config:

```json
{
  "mcpServers": {
    "defi-orchestrator": {
      "command": "npx",
      "args": ["@thryx/defi-orchestrator-mcp-server"],
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
| `defi_simulate_strategy` | Simulate a multi-step DeFi strategy from natural language with gas estimates and risk assessment | Free |
| `defi_execute_strategy` | Execute a previously simulated strategy on-chain (requires confirm=true) | Pro |
| `defi_quick_swap` | Single token swap with best execution across Uniswap V3 and Aerodrome | Pro |
| `defi_check_positions` | Check all DeFi positions for a wallet — Aave, tokens, portfolio summary | Free |
| `defi_get_yields` | Discover top yield opportunities across DeFi protocols on Base | Free |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `RPC_URL` | No | RPC endpoint (default: Base mainnet) |
| `DEPLOYER_PRIVATE_KEY` | No | For executing strategies and swaps |
| `THRYX_API_KEY` | No | Premium API key for execution access |

## Supported Chains

- Base (8453) — default
- Ethereum (1)
- Arbitrum One (42161)

## License

MIT
