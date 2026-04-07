# MCP Servers Monorepo

## Owner
Anthony (drlordbasil@gmail.com) — AI Agent Systems Engineer
GitHub: lordbasilaiassistant-sudo

## What This Is
A monorepo of MCP (Model Context Protocol) servers for the Base/EVM ecosystem. Each server is independently publishable to npm and registrable on MCP marketplaces (FastMCP, mcpmarket.com, Smithery).

## Architecture

```
mcp-servers/
├── CLAUDE.md                    # THIS FILE — monorepo-level guidance
├── shared/                      # Shared utilities across all servers
│   ├── src/
│   │   ├── evm-client.ts        # Shared ethers.js provider/signer setup
│   │   ├── mcp-helpers.ts       # mcpResult wrapper, error formatting
│   │   ├── chains.ts            # Chain configs (Base, Ethereum, Arbitrum, etc.)
│   │   └── types.ts             # Shared TypeScript types
│   ├── package.json
│   └── tsconfig.json
├── multi-wallet-mcp-server/     # Multi-wallet management for Base/EVM
├── token-deployer-mcp-server/   # Token deployment via OBSD LaunchPad
└── [future servers]/
```

## Conventions

### Naming
- **Directories**: `{service}-mcp-server` (kebab-case)
- **npm packages**: `@thryx/{service}-mcp-server`
- **Tool names**: `{service}_{action}_{resource}` (snake_case with service prefix)
  - e.g. `wallet_get_balances`, `wallet_list_wallets`, `token_deploy`, `token_scan_security`

### Tech Stack
- **Language**: TypeScript (strict mode)
- **MCP SDK**: `@modelcontextprotocol/sdk` (latest)
- **Schemas**: Zod for all input validation
- **EVM**: ethers.js v6
- **Transport**: stdio (primary), StreamableHTTP (for remote deployment)
- **Build**: tsc → dist/
- **Test**: vitest

### Tool Design Rules
1. Every tool description must be concise and unambiguous
2. Every tool must have Zod input schemas with `.describe()` on each field
3. Return JSON via `mcpResult()` helper — structured data, not prose
4. Include `explorerUrl` in any response that references an on-chain entity
5. Destructive operations require explicit `confirm: true` parameter
6. All RPC calls use shared provider with fallback
7. Never log to stdout (use stderr) — stdio transport requirement

### Error Handling
- Return `{ isError: true, content: [{ type: "text", text: JSON.stringify({ error, suggestion }) }] }`
- Always include actionable `suggestion` field in errors
- Never expose private keys or wallet passwords in error messages

### Environment Variables
- `RPC_URL` — Primary RPC endpoint (default: Base mainnet)
- `FALLBACK_RPC_URL` — Fallback RPC
- `DEPLOYER_PRIVATE_KEY` — For write operations (optional, tools degrade gracefully)
- `WALLET_PASSWORD` — For encrypted wallet storage (optional)

## Build & Run Commands

```bash
# Install all dependencies
cd shared && npm install && cd ..
cd multi-wallet-mcp-server && npm install && cd ..

# Build a specific server
cd multi-wallet-mcp-server && npm run build

# Run in stdio mode (for Claude Code / Cursor)
cd multi-wallet-mcp-server && node dist/index.js

# Run dev mode with hot reload
cd multi-wallet-mcp-server && npm run dev

# Test
cd multi-wallet-mcp-server && npm test
```

## Adding a New MCP Server

1. Copy the template structure from `multi-wallet-mcp-server/`
2. Update `package.json` name to `@thryx/{service}-mcp-server`
3. Create tools in `src/tools/` — one file per tool group
4. Register tools in `src/index.ts`
5. Add a `CLAUDE.md` in the server directory
6. Build and test: `npm run build && npm test`

## Publishing Checklist
- [ ] All tools have descriptions and Zod schemas
- [ ] `npm run build` succeeds with no errors
- [ ] `npm test` passes
- [ ] CLAUDE.md exists in server directory
- [ ] README.md with installation and usage instructions
- [ ] server.json manifest for MCP registries
- [ ] No hardcoded private keys or secrets
- [ ] .gitignore includes .env, wallets.json, dist/

## Related Projects
- `blockchain-web3/wallet-tools/multi-wallet-buy` — Source code for wallet management logic
- `blockchain-web3/token-tools/custom-token-deployer` — OBSD LaunchPad (has existing MCP server)
- `ai-agents/self-sov-ai` — SOVA agent OS (consumes these MCP servers)
