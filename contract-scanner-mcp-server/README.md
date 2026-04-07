# @thryx/contract-scanner-mcp-server

Smart contract security scanner for AI agents. Analyze any Solidity contract for vulnerabilities before interacting with it.

## Installation

```bash
npm install @thryx/contract-scanner-mcp-server
```

## Setup

Add to your MCP client config:

```json
{
  "mcpServers": {
    "contract-scanner": {
      "command": "npx",
      "args": ["@thryx/contract-scanner-mcp-server"],
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
| `scanner_analyze_contract` | Full security report with risk score 0-100, vulnerability findings, and actionable recommendations | Pro |
| `scanner_compare_contracts` | Compare two contracts side-by-side for clone detection and risk comparison | Pro |
| `scanner_check_address` | Quick check — contract vs EOA, verification status, risk flags | Free |
| `scanner_decode_calldata` | Decode raw calldata to human-readable function calls with danger flags | Free |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `RPC_URL` | No | RPC endpoint (default: Base mainnet) |
| `BASESCAN_API_KEY` | No | Enables verified source analysis on Base |
| `ETHERSCAN_API_KEY` | No | Enables verified source analysis on Ethereum |
| `ARBISCAN_API_KEY` | No | Enables verified source analysis on Arbitrum |
| `THRYX_API_KEY` | No | Premium API key for unlimited scans |

## Supported Chains

- Base (8453) — default
- Ethereum (1)
- Arbitrum One (42161)

## License

MIT
