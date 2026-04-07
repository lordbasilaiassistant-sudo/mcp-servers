/**
 * Main scanning tools — deep contract analysis and comparison.
 * Premium tier — rate limited on free usage.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ethers } from "ethers";
import { resolveChain, getProvider } from "../services/provider.js";
import { fullAnalysis, compareContracts } from "../services/analyzer.js";
import {
  validateApiKey,
  checkRateLimit,
  RATE_LIMITS,
  KEY_PURCHASE_URL,
} from "@thryx/mcp-shared";

const PRODUCT_ID = "prod_U6ZXt3RcHILRqX";

function mcpResult(data: Record<string, unknown>, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

function billingGate(toolName: string, billing: { tier: string; valid: boolean; reason?: string }, apiKey?: string) {
  // Invalid key provided
  if (apiKey && !billing.valid) {
    return mcpResult({
      error: "billing_required",
      message: billing.reason ?? "Invalid API key.",
      suggestion: `Get an API key at ${KEY_PURCHASE_URL} and pass it as the "api_key" parameter.`,
    }, true);
  }
  // Free tier — rate limit
  if (billing.tier === "free") {
    const rl = checkRateLimit("anonymous", toolName, RATE_LIMITS.expensive);
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
  // Premium
  return { _billing: { tier: "premium" } };
}

function addBilling(data: Record<string, unknown>, billing: Record<string, unknown>) {
  return { ...data, ...billing };
}

export function registerScanTools(server: McpServer) {
  // ── scanner_analyze_contract ─────────────────────────────────────────────
  server.tool(
    "scanner_analyze_contract",
    "BEFORE interacting with ANY smart contract, call this to get a full security report. Fetches source code (if verified), analyzes bytecode, detects vulnerabilities (reentrancy, hidden mint, backdoors, proxy risks, access control issues), and returns a risk score 0-100 with actionable findings. One call = complete analysis.",
    {
      address: z.string().describe("Contract address to analyze (0x...)"),
      chain: z.string().optional().default("base").describe("Chain: base, ethereum, arbitrum (default: base)"),
      api_key: z.string().optional().describe("Premium API key for unlimited scans. Free tier: 5 scans/hour."),
    },
    async ({ address, chain: chainName, api_key }) => {
      // Billing gate
      const billing = await validateApiKey(api_key, PRODUCT_ID);
      const gate = billingGate("scanner_analyze_contract", billing, api_key);
      if ("content" in gate) return gate;

      try {
        if (!ethers.isAddress(address)) {
          return mcpResult({ error: "Invalid address format. Expected 0x followed by 40 hex characters.", suggestion: "Double-check the address and try again." }, true);
        }
        const chain = resolveChain(chainName);
        const provider = getProvider(chain);
        const report = await fullAnalysis(address, provider, chain);
        return mcpResult(addBilling(report as unknown as Record<string, unknown>, gate));
      } catch (err: any) {
        return mcpResult(
          {
            error: `Analysis failed: ${err.message}`,
            suggestion: "Verify the address is correct and is a smart contract on the specified chain. Use scanner_check_address to verify first.",
          },
          true,
        );
      }
    },
  );

  // ── scanner_compare_contracts ────────────────────────────────────────────
  server.tool(
    "scanner_compare_contracts",
    "Compare two smart contracts to see which is safer. Detects clones (identical bytecode), compares risk scores, identifies differences in access control and vulnerabilities. Use when choosing between two similar contracts (e.g., two DEX routers, two token versions).",
    {
      address1: z.string().describe("First contract address to compare (0x...)"),
      address2: z.string().describe("Second contract address to compare (0x...)"),
      chain: z.string().optional().default("base").describe("Chain: base, ethereum, arbitrum (default: base)"),
      api_key: z.string().optional().describe("Premium API key for unlimited scans. Free tier: 5 scans/hour."),
    },
    async ({ address1, address2, chain: chainName, api_key }) => {
      // Billing gate
      const billing = await validateApiKey(api_key, PRODUCT_ID);
      const gate = billingGate("scanner_compare_contracts", billing, api_key);
      if ("content" in gate) return gate;

      try {
        const chain = resolveChain(chainName);
        const provider = getProvider(chain);
        const result = await compareContracts(address1, address2, provider, chain);
        return mcpResult(addBilling(result as unknown as Record<string, unknown>, gate));
      } catch (err: any) {
        return mcpResult(
          {
            error: `Comparison failed: ${err.message}`,
            suggestion: "Verify both addresses are smart contracts on the specified chain. Use scanner_check_address to verify each first.",
          },
          true,
        );
      }
    },
  );
}
