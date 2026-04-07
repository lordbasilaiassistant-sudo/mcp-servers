/**
 * Lookup tools — quick checks and calldata decoding.
 * Free tier with generous rate limits.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ethers } from "ethers";
import { resolveChain, getProvider } from "../services/provider.js";
import { quickCheck, decodeCalldata } from "../services/analyzer.js";
import {
  checkRateLimit,
  RATE_LIMITS,
  KEY_PURCHASE_URL,
} from "@thryx/mcp-shared";

function mcpResult(data: Record<string, unknown>, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

function freeGate(toolName: string) {
  const rl = checkRateLimit("anonymous", toolName, RATE_LIMITS.readOnly);
  if (!rl.allowed) {
    return mcpResult({
      error: "rate_limit_exceeded",
      message: `Free tier rate limit reached for ${toolName}. Resets in ${rl.retryAfterSeconds} seconds.`,
      retryAfterSeconds: rl.retryAfterSeconds,
      suggestion: `Wait ${rl.retryAfterSeconds}s, or upgrade to premium for unlimited access: ${KEY_PURCHASE_URL}`,
    }, true);
  }
  return { _billing: { tier: "free", remaining: rl.remaining, resetsAt: new Date(rl.resetsAt).toISOString() } };
}

export function registerLookupTools(server: McpServer) {
  // ── scanner_check_address ────────────────────────────────────────────────
  server.tool(
    "scanner_check_address",
    "Quick safety check on any address — is it a contract or EOA? Verified? Has selfdestruct, proxy, mint, pause, or blacklist? Returns risk flags in <1 second. Use this for fast triage before deciding whether to run a full scanner_analyze_contract scan.",
    {
      address: z.string().describe("Address to check (0x...)"),
      chain: z.string().optional().default("base").describe("Chain: base, ethereum, arbitrum (default: base)"),
      api_key: z.string().optional().describe("Optional premium API key to bypass rate limits."),
    },
    async ({ address, chain: chainName }) => {
      // Free tier rate limit
      const gate = freeGate("scanner_check_address");
      if ("content" in gate) return gate;

      try {
        if (!ethers.isAddress(address)) {
          return mcpResult({ error: "Invalid address format. Expected 0x followed by 40 hex characters.", suggestion: "Double-check the address and try again." }, true);
        }
        const chain = resolveChain(chainName);
        const provider = getProvider(chain);
        const result = await quickCheck(address, provider, chain);
        return mcpResult({ ...(result as unknown as Record<string, unknown>), ...gate });
      } catch (err: any) {
        return mcpResult(
          {
            error: `Check failed: ${err.message}`,
            suggestion: "Verify the address format (0x + 40 hex chars) and that the chain is correct.",
          },
          true,
        );
      }
    },
  );

  // ── scanner_decode_calldata ──────────────────────────────────────────────
  server.tool(
    "scanner_decode_calldata",
    "Decode raw transaction calldata into human-readable function calls. Identifies the function being called, decodes parameters, and flags dangerous operations (unlimited approve, delegatecall, ownership transfers). Use BEFORE signing any transaction you don't fully understand.",
    {
      calldata: z.string().describe("Raw calldata hex string (0x...)"),
      abi: z.string().optional().describe("Contract ABI as JSON string for full parameter decoding. If not provided, common selectors (ERC-20, Uniswap, etc.) are matched automatically."),
      api_key: z.string().optional().describe("Optional premium API key to bypass rate limits."),
    },
    async ({ calldata, abi }) => {
      // Free tier rate limit
      const gate = freeGate("scanner_decode_calldata");
      if ("content" in gate) return gate;

      try {
        const result = decodeCalldata(calldata, abi);
        return mcpResult({ ...(result as unknown as Record<string, unknown>), ...gate });
      } catch (err: any) {
        return mcpResult(
          {
            error: `Decode failed: ${err.message}`,
            suggestion: "Provide valid hex calldata (0x + hex). Optionally provide the contract ABI as a JSON string for full decoding.",
          },
          true,
        );
      }
    },
  );
}
