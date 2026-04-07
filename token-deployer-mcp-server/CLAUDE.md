# Token Deployer MCP Server

## What This Is
MCP server for deploying and managing tokens on Base via the OBSD LaunchPad. This is a **re-packaged, standalone version** of the existing MCP server in `blockchain-web3/token-tools/custom-token-deployer/mcp-server/`. The original code works — this server makes it independently publishable.

## Status: SCAFFOLD ONLY
The actual implementation lives in `../../blockchain-web3/token-tools/custom-token-deployer/mcp-server/`.
To make this publishable:
1. Copy `src/index.ts`, `src/handlers.ts`, `src/contracts/` from the original
2. Update imports to use ES module syntax
3. Add proper server.json manifest
4. Test and publish

## Tools (from existing implementation)
| Tool | Description | Key needed? |
|------|-------------|-------------|
| `get_platform_stats` | OBSD LaunchPad stats | No |
| `list_launches` | List launched tokens | No |
| `get_token_info` | Token details + earnings | No |
| `get_creator_earnings` | Creator OBSD earnings | No |
| `quote_buy` | Quote ETH→Token swap | No |
| `quote_sell` | Quote Token→ETH swap | No |
| `launch_token` | Deploy new token | Yes |
| `buy_token` | Buy token with ETH | Yes |
| `sell_token` | Sell token for ETH | Yes |
| `claim_fees` | Distribute pending fees | Yes |
| `get_pool_info` | Aerodrome pool stats | No |
| `get_staking_info` | OBSD staking vault stats | No |
| `register_referral` | Register affiliate code | Yes |
| `get_referral_stats` | Check referral earnings | No |
| `scan_token_security` | Security scan any ERC-20 | No |
| `get_trending_tokens` | DexScreener trending on Base | No |
| `analyze_wallet` | Wallet holdings analysis | No |

## Source Code Location
`/Desktop/blockchain-web3/token-tools/custom-token-deployer/mcp-server/`

## Build (once migrated)
```bash
npm install
npm run build
node dist/index.js
```
