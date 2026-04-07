#!/usr/bin/env node
/**
 * DeFi Orchestrator MCP Server
 *
 * MCP server for multi-step DeFi strategy orchestration on Base/EVM.
 * Tools: simulate strategies, execute compound DeFi operations,
 * check positions, find yield opportunities, quick-swap.
 *
 * Transport: stdio (default), StreamableHTTP (planned)
 *
 * @author Anthony <drlordbasil@gmail.com>
 * @package @thryx/defi-orchestrator-mcp-server
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerStrategyTools } from "./tools/strategy-tools.js";
import { registerPositionTools } from "./tools/position-tools.js";

const SERVER_NAME = "defi-orchestrator-mcp-server";
const SERVER_VERSION = "1.0.0";

function createServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  // Register all tool groups
  registerStrategyTools(server);
  registerPositionTools(server);

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
  console.error(`${SERVER_NAME} v${SERVER_VERSION} running on stdio`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
