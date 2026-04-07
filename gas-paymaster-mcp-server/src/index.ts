#!/usr/bin/env node
/**
 * Gas Paymaster MCP Server
 *
 * MCP server for gas credit management and sponsored transactions
 * via The Agent Cafe paymaster on Base mainnet.
 *
 * Tools: check gas tank, estimate costs, optimize batches,
 * send sponsored transactions, view price history.
 *
 * Transport: stdio (default), StreamableHTTP (planned)
 *
 * @author Anthony <drlordbasil@gmail.com>
 * @package @thryx/gas-paymaster-mcp-server
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerGasTools } from "./tools/gas-tools.js";
import { registerTxTools } from "./tools/tx-tools.js";

const SERVER_NAME = "gas-paymaster-mcp-server";
const SERVER_VERSION = "1.0.0";

function createServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  // Register all tool groups
  registerGasTools(server);
  registerTxTools(server);

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
