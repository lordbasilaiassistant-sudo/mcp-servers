/**
 * Gas management tools — check tank, estimate costs, view price history.
 * All read-only / free tier tools.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ethers } from "ethers";
import {
  mcpResult,
  mcpError,
  checkRateLimit,
  RATE_LIMITS,
  KEY_PURCHASE_URL,
} from "@thryx/mcp-shared";
import {
  resolveChain,
  estimateGas,
  getGasHistory,
} from "../services/gas-oracle.js";
import { checkTank, canPaymasterCover } from "../services/paymaster.js";

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

const RELATED_TOOLS = [
  "gas_check_tank",
  "gas_estimate",
  "gas_optimize_batch",
  "gas_send_sponsored",
  "gas_price_history",
];

export function registerGasTools(server: McpServer) {
  // ── gas_check_tank ──────────────────────────────────────────────────────
  server.tool(
    "gas_check_tank",
    "Check gas credit balance in The Agent Cafe paymaster. Returns credit balance in ETH/USD, estimated transactions remaining, tank health status, and next-action suggestion. No API key needed.",
    {
      wallet: z
        .string()
        .optional()
        .describe("Wallet address to check. Defaults to deployer wallet."),
    },
    async ({ wallet }) => {
      // Free tier rate limit
      const gate = freeGate("gas_check_tank");
      if ("content" in gate) return gate as any;

      try {
        const tank = await checkTank(wallet);
        return mcpResult({
          ...tank,
          ...gate,
          related_tools: RELATED_TOOLS.filter((t) => t !== "gas_check_tank"),
        }) as any;
      } catch (err: any) {
        return mcpError(
          `Failed to check gas tank: ${err.message}`,
          "Ensure RPC_URL is set and the Base mainnet RPC is reachable.",
        ) as any;
      }
    },
  );

  // ── gas_estimate ────────────────────────────────────────────────────────
  server.tool(
    "gas_estimate",
    "Estimate gas cost for a transaction on any EVM chain. Returns cost in ETH and USD at slow/standard/fast speeds, whether the paymaster can cover it, and optimal timing advice. No API key needed.",
    {
      to: z.string().describe("Destination address for the transaction"),
      data: z
        .string()
        .optional()
        .describe("Transaction calldata (hex encoded). Omit for simple ETH transfers."),
      value: z
        .string()
        .optional()
        .describe("ETH value to send (in ETH, e.g. '0.1'). Defaults to 0."),
      chain: z
        .string()
        .optional()
        .default("base")
        .describe("Chain name or ID (default: base)"),
    },
    async ({ to, data, value, chain: chainName }) => {
      // Free tier rate limit
      const gate = freeGate("gas_estimate");
      if ("content" in gate) return gate as any;

      try {
        const chain = resolveChain(chainName);
        const estimate = await estimateGas(chain, to, data, value);

        // Check if paymaster can cover it
        const coverage = await canPaymasterCover(estimate.gasCostWei);

        // Timing advice
        const history = await getGasHistory(chain, 1);
        let timingSuggestion: string;
        if (history.currentPercentile === null) {
          timingSuggestion =
            "Not enough gas price history to assess timing. Safe to send now.";
        } else if (history.currentPercentile > 80) {
          timingSuggestion =
            "Gas is currently expensive (top 20%). Consider waiting for prices to drop if not urgent.";
        } else if (history.currentPercentile < 20) {
          timingSuggestion =
            "Gas is currently cheap (bottom 20%). Great time to send!";
        } else {
          timingSuggestion = "Gas prices look normal. Safe to send now.";
        }

        return mcpResult({
          chain: chain.name,
          chainId: chain.chainId,
          to,
          gasLimit: estimate.gasLimit.toString(),
          speeds: estimate.speeds,
          standardCost: {
            eth: estimate.gasCostEth,
            usd: "$" + estimate.gasCostUsd,
          },
          gasPrice: ethers.formatUnits(estimate.gasPrice, "gwei") + " gwei",
          paymasterCoverage: {
            covered: coverage.covered,
            tankBalance: ethers.formatEther(coverage.tankBalance) + " ETH",
            ...(coverage.deficit > 0n
              ? { deficit: ethers.formatEther(coverage.deficit) + " ETH" }
              : {}),
          },
          timing: timingSuggestion,
          suggestion: coverage.covered
            ? "Paymaster can cover this transaction. Use gas_send_sponsored to send it."
            : "Paymaster cannot cover this. Refill gas credits at The Agent Cafe first.",
          ...gate,
          related_tools: RELATED_TOOLS.filter((t) => t !== "gas_estimate"),
        }) as any;
      } catch (err: any) {
        return mcpError(
          `Gas estimation failed: ${err.message}`,
          "Check that the 'to' address is valid and the chain RPC is reachable.",
        ) as any;
      }
    },
  );

  // ── gas_price_history ───────────────────────────────────────────────────
  server.tool(
    "gas_price_history",
    "Get gas price trends for the last N hours. Returns average/min/max prices, current percentile, cheapest time windows, and trend direction. Useful for deciding when to send transactions. No API key needed.",
    {
      chain: z
        .string()
        .optional()
        .default("base")
        .describe("Chain name or ID (default: base)"),
      hours: z
        .number()
        .optional()
        .default(24)
        .describe("Hours of history to analyze (default: 24, max: 24)"),
    },
    async ({ chain: chainName, hours }) => {
      // Free tier rate limit
      const gate = freeGate("gas_price_history");
      if ("content" in gate) return gate as any;

      try {
        const chain = resolveChain(chainName);
        const clampedHours = Math.min(Math.max(1, hours ?? 24), 24);
        const history = await getGasHistory(chain, clampedHours);

        // Generate actionable suggestion
        let suggestion: string;
        if (history.currentPercentile === null) {
          suggestion = `Not enough samples yet (${history.sampleCount} collected, need 5+). ${history.note ?? "Gas oracle is warming up."}`;
        } else if (history.currentPercentile > 75) {
          suggestion = `Gas is in the ${history.currentPercentile}th percentile (expensive). Wait for a dip if possible.`;
          if (history.bestWindows.length > 0) {
            suggestion += ` Cheapest window: UTC hour ${history.bestWindows[0].hour} (avg ${history.bestWindows[0].avgGwei} gwei).`;
          }
        } else if (history.currentPercentile < 25) {
          suggestion = `Gas is in the ${history.currentPercentile}th percentile (cheap). Good time to send transactions!`;
        } else {
          suggestion = `Gas is at the ${history.currentPercentile}th percentile (normal). No need to wait.`;
        }

        return mcpResult({
          chain: chain.name,
          chainId: chain.chainId,
          ...history,
          average: history.average + " gwei",
          min: history.min + " gwei",
          max: history.max + " gwei",
          current: history.current + " gwei",
          suggestion,
          ...gate,
          related_tools: RELATED_TOOLS.filter(
            (t) => t !== "gas_price_history",
          ),
        }) as any;
      } catch (err: any) {
        return mcpError(
          `Failed to fetch gas history: ${err.message}`,
          "The gas oracle needs time to collect samples. Try again in a few minutes.",
        ) as any;
      }
    },
  );
}
