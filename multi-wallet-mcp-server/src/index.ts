#!/usr/bin/env node
/**
 * Multi-Wallet MCP Server
 *
 * MCP server for multi-wallet management on Base/EVM chains.
 * Tools: generate wallets, check balances, distribute ETH,
 * consolidate funds, scan tokens, check gas prices.
 *
 * Transport: stdio (default), StreamableHTTP (planned)
 *
 * @author Anthony <drlordbasil@gmail.com>
 * @package @thryx/multi-wallet-mcp-server
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerWalletTools } from "./tools/wallet-tools.js";
import { registerDistributionTools } from "./tools/distribution-tools.js";
import { registerAnalysisTools } from "./tools/analysis-tools.js";
import { loadFromEnv } from "./services/wallet-store.js";

const SERVER_NAME = "multi-wallet-mcp-server";
const SERVER_VERSION = "1.0.0";

function createServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  // Register all tool groups
  registerWalletTools(server);
  registerDistributionTools(server);
  registerAnalysisTools(server);

  // Load deployer wallet from env if available
  loadFromEnv();

  return server;
}

// Smithery sandbox export
export function createSandboxServer() {
  return createServer();
}

// Start stdio transport
async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr (not stdout — stdio transport requirement)
  console.error(`${SERVER_NAME} v${SERVER_VERSION} running on stdio`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
