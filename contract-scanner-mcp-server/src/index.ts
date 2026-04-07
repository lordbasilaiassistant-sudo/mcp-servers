#!/usr/bin/env node
/**
 * Contract Scanner MCP Server
 *
 * Solidity smart contract security scanner for AI agents.
 * Analyzes contracts for vulnerabilities BEFORE interacting with them.
 *
 * Tools:
 *   scanner_analyze_contract  — Full security report (premium)
 *   scanner_compare_contracts — Compare two contracts (premium)
 *   scanner_check_address     — Quick risk check (free)
 *   scanner_decode_calldata   — Decode transaction data (free)
 *
 * Transport: stdio (default)
 *
 * @author Anthony <drlordbasil@gmail.com>
 * @package @thryx/contract-scanner-mcp-server
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerScanTools } from "./tools/scan-tools.js";
import { registerLookupTools } from "./tools/lookup-tools.js";

const SERVER_NAME = "contract-scanner-mcp-server";
const SERVER_VERSION = "1.0.0";

function createServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  // Register all tool groups
  registerScanTools(server);
  registerLookupTools(server);

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
  console.error(`Environment: BASESCAN_API_KEY=${process.env.BASESCAN_API_KEY ? "set" : "NOT SET"}, ETHERSCAN_API_KEY=${process.env.ETHERSCAN_API_KEY ? "set" : "NOT SET"}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
