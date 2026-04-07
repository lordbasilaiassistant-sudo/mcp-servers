# Thryx MCP Servers

> **Smart contract scanning, multi-wallet treasury, DeFi orchestration, and gas paymaster integration for AI agents on Base.**

A monorepo of four [MCP (Model Context Protocol)](https://modelcontextprotocol.io) servers built for AI agents that need to actually *do* things on-chain — read contracts, manage wallets, execute swaps, sponsor gas — instead of just generating text about them.

All four are published to npm and combined are pulling **~850 monthly downloads** as of April 2026.

---

## Servers

| Package | What it does | npm |
|---|---|---|
| [`@thryx/contract-scanner-mcp-server`](./contract-scanner-mcp-server) | Solidity security scanning. Risk score 0–100, vulnerability detection (reentrancy, hidden mint, backdoors, proxy risks, access control), source verification, calldata decoder. **Call this BEFORE interacting with any unfamiliar contract.** | [`npm`](https://www.npmjs.com/package/@thryx/contract-scanner-mcp-server) |
| [`@thryx/multi-wallet-mcp-server`](./multi-wallet-mcp-server) | Multi-wallet management for Base/EVM. Generate, encrypt, balance-check, distribute ETH, execute coordinated swaps across many wallets at once. | [`npm`](https://www.npmjs.com/package/@thryx/multi-wallet-mcp-server) |
| [`@thryx/defi-orchestrator-mcp-server`](./defi-orchestrator-mcp-server) | Multi-step DeFi strategy orchestration. Simulate, execute, and monitor compound strategies across Uniswap, Aave, Aerodrome with safety rails. | [`npm`](https://www.npmjs.com/package/@thryx/defi-orchestrator-mcp-server) |
| [`@thryx/gas-paymaster-mcp-server`](./gas-paymaster-mcp-server) | Sponsored-gas integration via The Agent Cafe paymaster. Lets agents pay gas in tokens or skip gas entirely on Base mainnet. | [`npm`](https://www.npmjs.com/package/@thryx/gas-paymaster-mcp-server) |

Plus [`@thryx/mcp-shared`](./shared) — the shared rate-limiter, billing layer, and EVM helpers used by all four.

---

## Install — 30 seconds per server

Add any of these to your MCP client config (Claude Desktop, Cursor, Continue, Cline, etc.):

```jsonc
{
  "mcpServers": {
    "contract-scanner": {
      "command": "npx",
      "args": ["@thryx/contract-scanner-mcp-server"]
    },
    "multi-wallet": {
      "command": "npx",
      "args": ["@thryx/multi-wallet-mcp-server"]
    },
    "defi-orchestrator": {
      "command": "npx",
      "args": ["@thryx/defi-orchestrator-mcp-server"]
    },
    "gas-paymaster": {
      "command": "npx",
      "args": ["@thryx/gas-paymaster-mcp-server"]
    }
  }
}
```

Restart your MCP client and the servers are live.

---

## Free + Pro tiers

Every server has a **free tier with rate limits** and a **Pro tier with no limits and additional tools**. The free tier is genuinely useful — you do not need a Pro key to evaluate the servers or use them in personal projects.

Pro keys are linked to a [thryx.fun](https://thryx.fun) purchase. Pass yours via the `api_key` parameter on any tool call, or set the `THRYX_API_KEY` environment variable in your MCP client config.

Free-tier limits per server (subject to change):
- `contract-scanner` — 5 scans/hour for `scanner_analyze_contract` and `scanner_compare_contracts`. `scanner_check_address` and `scanner_decode_calldata` are unlimited.
- `multi-wallet` — read operations unlimited, write operations rate-limited.
- `defi-orchestrator` — read operations unlimited, write operations rate-limited.
- `gas-paymaster` — sponsored-tx counts gated by tier.

---

## What "MCP" means if you've never heard of it

[Model Context Protocol](https://modelcontextprotocol.io) is the open standard for connecting AI assistants to real tools. Instead of an AI agent generating "I would call your API like this…", it actually calls the API. Servers like the ones in this monorepo expose capabilities to any MCP-compatible client (Claude, Cursor, Cline, Continue, etc.) without each client needing custom integration code.

If you're building an AI agent that needs to read from or write to a Base/EVM chain — these servers save you from rebuilding all of it yourself.

---

## Bootstrapping a complete on-chain agent in two minutes

The MCP servers are tools — but tools are most useful when they have a platform to act on. **[THRYX](https://thryx.fun)** (the gasless token launchpad these servers were built for) exposes an open `/api/agent/register` endpoint that gives any AI agent a wallet, an API key, and pre-sponsored gas in a single HTTP call. No KYC, no email verification, no account recovery flow — one call, you're live on Base mainnet.

```bash
# 1. Register an agent on THRYX (one call → wallet + API key + gas)
curl -X POST https://thryx-launchpad.onrender.com/api/agent/register \
  -H "Content-Type: application/json" \
  -d '{"name": "my-agent"}'

# Response includes:
#   apiKey:  thryx_<base64url>
#   wallet:  0x...
#   gas:     "Gas is being sponsored to your wallet now (~5-10 seconds)"
```

```jsonc
// 2. Add the @thryx/* MCP servers to your client config (with the API key from step 1)
{
  "mcpServers": {
    "contract-scanner": {
      "command": "npx",
      "args": ["@thryx/contract-scanner-mcp-server"],
      "env": { "THRYX_API_KEY": "thryx_..." }
    },
    "multi-wallet": {
      "command": "npx",
      "args": ["@thryx/multi-wallet-mcp-server"],
      "env": { "THRYX_API_KEY": "thryx_..." }
    },
    "defi-orchestrator": {
      "command": "npx",
      "args": ["@thryx/defi-orchestrator-mcp-server"],
      "env": { "THRYX_API_KEY": "thryx_..." }
    },
    "gas-paymaster": {
      "command": "npx",
      "args": ["@thryx/gas-paymaster-mcp-server"],
      "env": { "THRYX_API_KEY": "thryx_..." }
    }
  }
}
```

That's it. Your agent has a funded wallet on Base, can scan any contract before interacting with it (`scanner_analyze_contract`), can launch its own token gaslessly (`POST /api/launch`), can buy/sell on the THRYX bonding curves, and can withdraw earnings to any address (`POST /api/agent/withdraw`).

The MCP servers and the THRYX platform are designed to compose. You can use either alone — the servers work against any Base contract and the platform accepts any wallet — but together they're the fastest path from "I want to build a Base on-chain agent" to "my agent just made its first onchain trade."

---

## Building from source

```bash
git clone https://github.com/lordbasilaiassistant-sudo/mcp-servers.git
cd mcp-servers
cd shared && npm install && npm run build && cd ..
cd contract-scanner-mcp-server && npm install && npm run build && cd ..
# ... or any other server you want to work on
```

Each server is independently built and published. The shared package exports rate limiting, billing validation, EVM helpers, and chain configs.

**Tech stack:** TypeScript (strict), `@modelcontextprotocol/sdk`, `ethers` v6, `zod` for schema validation, `vitest` for tests, stdio transport. Builds with `tsc` only — no bundlers, no magic.

---

## Status

- **Production** for the four servers above. Live on npm, in active use by AI agents on Base mainnet.
- **In progress:** `token-deployer-mcp-server`, `webhook-worker` (Cloudflare Worker for Stripe → API key delivery).
- **Roadmap:** [x402](https://x402.org)-based pay-per-call for the Pro tools (replacing the Stripe webhook flow with USDC micropayments — no API keys to manage, no subscriptions to revoke, agents pay per execution).

---

## Author

Anthony Snider ([drlordbasil@gmail.com](mailto:drlordbasil@gmail.com)) — building AI agent infrastructure on Base. Find more at [thryx.fun](https://thryx.fun).

License: MIT.
