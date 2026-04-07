/**
 * Sponsored transaction tools — batch optimization and sponsored sends.
 * Premium tier tools (require API key or degrade gracefully).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ethers } from "ethers";
import {
  mcpResult,
  mcpError,
  validateApiKey,
  checkRateLimit,
  RATE_LIMITS,
  KEY_PURCHASE_URL,
} from "@thryx/mcp-shared";
import {
  resolveChain,
  estimateGas,
  getCurrentGasPrices,
  getEthPriceUsd,
} from "../services/gas-oracle.js";
import { checkTank, sendSponsored, canPaymasterCover } from "../services/paymaster.js";

const RELATED_TOOLS = [
  "gas_check_tank",
  "gas_estimate",
  "gas_optimize_batch",
  "gas_send_sponsored",
  "gas_price_history",
];

const PRODUCT_ID = "prod_U7Ibpd4u8gAV5o";

function premiumGate(toolName: string, billing: { tier: string; valid: boolean; reason?: string }, apiKey?: string) {
  if (apiKey && !billing.valid) {
    return mcpResult({
      error: "billing_required",
      message: billing.reason ?? "Invalid API key.",
      suggestion: `Get an API key at ${KEY_PURCHASE_URL} and pass it as the "api_key" parameter.`,
    }, true);
  }
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
  return { _billing: { tier: "premium" } };
}

/** Multicall3 address (same on all EVM chains) */
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";

export function registerTxTools(server: McpServer) {
  // ── gas_optimize_batch ──────────────────────────────────────────────────
  server.tool(
    "gas_optimize_batch",
    "Analyze a batch of transactions for gas optimization. Calculates total cost, identifies which can be batched via Multicall3, estimates savings, and recommends whether to send now or wait. Premium tool — pass api_key for unlimited access.",
    {
      transactions: z
        .array(
          z.object({
            to: z.string().describe("Destination address"),
            data: z
              .string()
              .optional()
              .describe("Transaction calldata (hex). Omit for ETH transfers."),
            value: z
              .string()
              .optional()
              .describe("ETH value to send (e.g. '0.01')"),
          }),
        )
        .min(1)
        .max(50)
        .describe("Array of transactions to analyze (1-50)"),
      chain: z
        .string()
        .optional()
        .default("base")
        .describe("Chain name or ID (default: base)"),
      api_key: z
        .string()
        .optional()
        .describe("Premium API key for unlimited access"),
    },
    async ({ transactions, chain: chainName, api_key }) => {
      // Premium billing gate
      const billing = await validateApiKey(api_key, PRODUCT_ID);
      const gate = premiumGate("gas_optimize_batch", billing, api_key);
      if ("content" in gate) return gate as any;

      try {
        const chain = resolveChain(chainName);
        const ethPrice = await getEthPriceUsd(chain);
        const prices = await getCurrentGasPrices(chain);

        // Estimate each transaction individually
        const estimates = await Promise.all(
          transactions.map(async (tx, i) => {
            try {
              const est = await estimateGas(chain, tx.to, tx.data, tx.value);
              return {
                index: i,
                to: tx.to,
                gasLimit: est.gasLimit,
                gasCostEth: est.gasCostEth,
                gasCostUsd: est.gasCostUsd,
                hasCalldata: !!tx.data,
                hasValue: !!tx.value && tx.value !== "0",
                error: null as string | null,
              };
            } catch (err: any) {
              return {
                index: i,
                to: tx.to,
                gasLimit: 0n,
                gasCostEth: "0",
                gasCostUsd: "0",
                hasCalldata: !!tx.data,
                hasValue: !!tx.value && tx.value !== "0",
                error: err.message as string | null,
              };
            }
          }),
        );

        // Total individual cost
        const totalGasIndividual = estimates.reduce(
          (sum, e) => sum + e.gasLimit,
          0n,
        );
        const totalCostWeiIndividual = totalGasIndividual * prices.standard;
        const totalCostEthIndividual = ethers.formatEther(totalCostWeiIndividual);
        const totalCostUsdIndividual = (
          parseFloat(totalCostEthIndividual) * ethPrice
        ).toFixed(4);

        // Identify batchable transactions (contract calls without ETH value)
        const batchable = estimates.filter(
          (e) => e.hasCalldata && !e.hasValue && !e.error,
        );
        const nonBatchable = estimates.filter(
          (e) => !e.hasCalldata || e.hasValue || e.error,
        );

        // Estimate batched cost
        let batchedGas = 0n;
        let batchSavings = "0";
        let batchSavingsPercent = 0;

        if (batchable.length > 1) {
          const multicallOverhead = 25000n + BigInt(batchable.length) * 10000n;
          const batchedCallGas = batchable.reduce(
            (sum, e) => sum + e.gasLimit,
            0n,
          );
          const savingsPerCall = 21000n;
          batchedGas =
            batchedCallGas -
            savingsPerCall * BigInt(batchable.length - 1) +
            multicallOverhead;

          const savedGas = batchable.reduce((s, e) => s + e.gasLimit, 0n) - batchedGas;
          if (savedGas > 0n) {
            const savedWei = savedGas * prices.standard;
            batchSavings = ethers.formatEther(savedWei);
            batchSavingsPercent =
              totalGasIndividual > 0n
                ? Number((savedGas * 100n) / totalGasIndividual)
                : 0;
          }
        }

        // Total batched cost
        const nonBatchableGas = nonBatchable.reduce(
          (sum, e) => sum + e.gasLimit,
          0n,
        );
        const totalGasBatched =
          batchable.length > 1
            ? batchedGas + nonBatchableGas
            : totalGasIndividual;
        const totalCostWeiBatched = totalGasBatched * prices.standard;
        const totalCostEthBatched = ethers.formatEther(totalCostWeiBatched);
        const totalCostUsdBatched = (
          parseFloat(totalCostEthBatched) * ethPrice
        ).toFixed(4);

        // Paymaster coverage check
        const coverage = await canPaymasterCover(totalCostWeiBatched);

        // Recommendation
        let recommendation: string;
        if (!coverage.covered) {
          recommendation =
            "Paymaster cannot cover the batch. Refill gas credits first, then send.";
        } else if (batchable.length > 1 && batchSavingsPercent > 5) {
          recommendation = `Batch ${batchable.length} contract calls via Multicall3 to save ~${batchSavingsPercent}% gas ($${(parseFloat(batchSavings) * ethPrice).toFixed(4)}). Send now — paymaster has sufficient credits.`;
        } else {
          recommendation =
            "Send transactions individually — batching savings are minimal. Paymaster has credits.";
        }

        return mcpResult({
          chain: chain.name,
          chainId: chain.chainId,
          transactionCount: transactions.length,
          individualCost: {
            totalGas: totalGasIndividual.toString(),
            totalEth: totalCostEthIndividual,
            totalUsd: "$" + totalCostUsdIndividual,
          },
          batchedCost: {
            totalGas: totalGasBatched.toString(),
            totalEth: totalCostEthBatched,
            totalUsd: "$" + totalCostUsdBatched,
          },
          savings: {
            gasUnits: (totalGasIndividual - totalGasBatched).toString(),
            eth: batchSavings,
            usd: "$" + (parseFloat(batchSavings) * ethPrice).toFixed(4),
            percent: batchSavingsPercent + "%",
          },
          batching: {
            batchableCount: batchable.length,
            nonBatchableCount: nonBatchable.length,
            batchableIndices: batchable.map((e) => e.index),
            multicallAddress: batchable.length > 1 ? MULTICALL3 : null,
          },
          paymasterCoverage: {
            covered: coverage.covered,
            tankBalance: ethers.formatEther(coverage.tankBalance) + " ETH",
          },
          estimates: estimates.map((e) => ({
            index: e.index,
            to: e.to,
            gasLimit: e.gasLimit.toString(),
            costEth: e.gasCostEth,
            costUsd: "$" + e.gasCostUsd,
            batchable: e.hasCalldata && !e.hasValue && !e.error,
            ...(e.error ? { error: e.error } : {}),
          })),
          recommendation,
          ...gate,
          related_tools: RELATED_TOOLS.filter(
            (t) => t !== "gas_optimize_batch",
          ),
        }) as any;
      } catch (err: any) {
        return mcpError(
          `Batch optimization failed: ${err.message}`,
          "Ensure all transaction addresses are valid and the chain RPC is reachable.",
        ) as any;
      }
    },
  );

  // ── gas_send_sponsored ──────────────────────────────────────────────────
  server.tool(
    "gas_send_sponsored",
    "Send a transaction sponsored by The Agent Cafe paymaster. Checks gas tank credits first, submits via paymaster if sufficient, returns tx hash and remaining credits. Premium tool — pass api_key for unlimited use. Set confirm: true to execute.",
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
        .describe("Chain name or ID (default: base). Currently only Base is supported for sponsored txs."),
      confirm: z
        .boolean()
        .optional()
        .default(false)
        .describe("Set to true to actually send. When false, returns a dry-run estimate."),
      api_key: z
        .string()
        .optional()
        .describe("Premium API key for unlimited access"),
    },
    async ({ to, data, value, chain: chainName, confirm, api_key }) => {
      // Premium billing gate
      const billing = await validateApiKey(api_key, PRODUCT_ID);
      const gate = premiumGate("gas_send_sponsored", billing, api_key);
      if ("content" in gate) return gate as any;

      try {
        const chain = resolveChain(chainName);

        // Always estimate first
        const estimate = await estimateGas(chain, to, data, value);
        const coverage = await canPaymasterCover(estimate.gasCostWei);
        const tank = await checkTank();

        // Dry run mode
        if (!confirm) {
          return mcpResult({
            mode: "dry_run",
            chain: chain.name,
            chainId: chain.chainId,
            to,
            estimatedGas: estimate.gasLimit.toString(),
            estimatedCost: {
              eth: estimate.gasCostEth,
              usd: "$" + estimate.gasCostUsd,
            },
            speeds: estimate.speeds,
            paymasterCoverage: {
              covered: coverage.covered,
              tankBalance: tank.balanceEth + " ETH",
              tankHealth: tank.health,
            },
            suggestion: coverage.covered
              ? "Ready to send. Set confirm: true to execute the transaction."
              : `Paymaster cannot cover this (need ${ethers.formatEther(coverage.deficit)} more ETH). Refill at The Agent Cafe.`,
            ...gate,
            related_tools: RELATED_TOOLS.filter(
              (t) => t !== "gas_send_sponsored",
            ),
          }) as any;
        }

        // Check chain — only Base supported for sponsored txs
        if (chain.chainId !== 8453) {
          return mcpError(
            "Sponsored transactions are currently only supported on Base mainnet.",
            "Set chain to 'base' or omit the chain parameter.",
          ) as any;
        }

        // Check coverage
        if (!coverage.covered) {
          return mcpError(
            `Insufficient gas credits. Tank: ${tank.balanceEth} ETH, needed: ${estimate.gasCostEth} ETH.`,
            "Eat at The Agent Cafe to refill gas credits, or deposit ETH to the paymaster.",
          ) as any;
        }

        // Send it
        const result = await sendSponsored(to, data, value);

        return mcpResult({
          mode: "executed",
          ...result,
          chain: chain.name,
          chainId: chain.chainId,
          suggestion: `Transaction sent successfully. ${result.remainingCredits} ETH remaining in gas tank.`,
          ...gate,
          related_tools: RELATED_TOOLS.filter(
            (t) => t !== "gas_send_sponsored",
          ),
        }) as any;
      } catch (err: any) {
        return mcpError(
          `Sponsored transaction failed: ${err.message}`,
          "Check DEPLOYER_PRIVATE_KEY is set and the gas tank has credits. Use gas_check_tank to verify.",
        ) as any;
      }
    },
  );
}
