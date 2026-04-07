# @thryx/multi-wallet-mcp-server

Multi-wallet management for AI agents on Base/EVM. Generate wallet pools, check balances, distribute ETH, and scan tokens.

## Installation

```bash
npm install @thryx/multi-wallet-mcp-server
```

## Setup

Add to your MCP client config:

```json
{
  "mcpServers": {
    "multi-wallet": {
      "command": "npx",
      "args": ["@thryx/multi-wallet-mcp-server"],
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
| `wallet_generate` | Generate N new EVM wallets (keys stored server-side, never exposed) | Pro |
| `wallet_import` | Import existing wallet by private key | Pro |
| `wallet_list` | List all managed wallets with addresses and labels | Free |
| `wallet_get_balances` | Check ETH + token balances for a single wallet | Free |
| `wallet_get_all_balances` | Batch check ETH balances for all managed wallets | Free |
| `wallet_get_token_balance` | Check any ERC-20 token balance | Free |
| `wallet_distribute_eth` | Distribute ETH from one wallet to many (simulation supported) | Pro |
| `wallet_consolidate_eth` | Sweep ETH from all wallets to one address | Pro |
| `wallet_scan_token` | Security scan a token contract for rug risk (score 0-100) | Free |
| `wallet_get_gas` | Current gas prices on chain | Free |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `RPC_URL` | No | RPC endpoint (default: Base mainnet) |
| `DEPLOYER_PRIVATE_KEY` | No | For write operations (distribute, consolidate) |
| `THRYX_API_KEY` | No | Premium API key for unlimited access |

## Supported Chains

- Base (8453) — default
- Ethereum (1)
- Arbitrum One (42161)

## License

MIT
