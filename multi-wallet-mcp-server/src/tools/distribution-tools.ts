/**
 * Distribution tools — spread ETH across wallets, consolidate back.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ethers } from "ethers";
import {
  mcpResult,
  validateApiKey,
  checkRateLimit,
  RATE_LIMITS,
  KEY_PURCHASE_URL,
} from "@thryx/mcp-shared";
import { getProvider, resolveChain, getSigner } from "../services/provider.js";
import { listWallets, getWalletSigner } from "../services/wallet-store.js";



const PRODUCT_ID = "prod_U7Ibjkw0hMHtzs";

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

export function registerDistributionTools(server: McpServer) {
  // ── wallet_distribute_eth ────────────────────────────────────
  server.tool(
    "wallet_distribute_eth",
    "Distribute ETH from a source wallet to multiple destination wallets. Useful for funding a wallet pool before coordinated operations.",
    {
      from_address: z.string().describe("Source wallet address (must be a managed wallet or the deployer)"),
      to_addresses: z.array(z.string()).optional().describe("Specific destination addresses. If omitted, distributes to ALL managed wallets."),
      amount_each: z.string().describe("Amount of ETH to send to each wallet (e.g. '0.001')"),
      chain: z.string().optional().default("base").describe("Chain name (default: base)"),
      confirm: z.boolean().default(false).describe("Must be true to execute. Set false to simulate first."),
      api_key: z.string().optional().describe("Premium API key for unlimited access. Free tier: 5/hour."),
    },
    async ({ from_address, to_addresses, amount_each, chain: chainName, confirm, api_key }) => {
      // Premium billing gate
      const billing = await validateApiKey(api_key, PRODUCT_ID);
      const gate = premiumGate("wallet_distribute_eth", billing, api_key);
      if ("content" in gate) return gate;
      try {
        const chain = resolveChain(chainName);
        const provider = getProvider(chain);
        // Validate from_address
        if (!ethers.isAddress(from_address)) {
          return mcpResult({ error: "Invalid from_address.", suggestion: "Provide a valid 0x... EVM address." }, true);
        }

        // Validate to_addresses if provided
        if (to_addresses) {
          for (const addr of to_addresses) {
            if (!ethers.isAddress(addr)) {
              return mcpResult({ error: `Invalid destination address: ${addr}`, suggestion: "All destination addresses must be valid 0x... EVM addresses." }, true);
            }
          }
        }

        const amountWei = ethers.parseEther(amount_each);

        // Resolve destinations
        const destinations = to_addresses ?? listWallets().map((w) => w.address);
        if (destinations.length === 0) {
          return mcpResult({ error: "No destination wallets.", suggestion: "Generate wallets first with wallet_generate." }, true);
        }

        const totalNeeded = amountWei * BigInt(destinations.length);
        const fromBalance = await provider.getBalance(from_address);

        // Simulation mode
        if (!confirm) {
          return mcpResult({
            action: "wallet_distribute_eth (SIMULATION)",
            from: from_address,
            fromBalance: ethers.formatEther(fromBalance),
            destinations: destinations.length,
            amountEach: amount_each,
            totalRequired: ethers.formatEther(totalNeeded),
            sufficient: fromBalance >= totalNeeded,
            note: "Set confirm=true to execute this distribution.",
            ...gate,
          });
        }

        // Get signer
        const signer = getWalletSigner(from_address, provider) ??
          (from_address.toLowerCase() === (getSigner(chain)?.address.toLowerCase() ?? "") ? getSigner(chain) : null);

        if (!signer) {
          return mcpResult({
            error: "Cannot sign from this address. It must be a managed wallet or the deployer.",
            suggestion: "Import the wallet first with wallet_import, or use the deployer address.",
          }, true);
        }

        if (fromBalance < totalNeeded) {
          return mcpResult({
            error: `Insufficient balance. Need ${ethers.formatEther(totalNeeded)} ETH, have ${ethers.formatEther(fromBalance)}.`,
            suggestion: "Reduce the amount_each, send to fewer wallets, or fund the source wallet with more ETH.",
          }, true);
        }

        // Execute transfers sequentially to manage nonce
        const results: Array<{ to: string; txHash: string; status: string }> = [];
        let nonce = await provider.getTransactionCount(from_address, "latest");

        for (const dest of destinations) {
          try {
            const tx = await signer.sendTransaction({
              to: dest,
              value: amountWei,
              nonce: nonce++,
            });
            const receipt = await tx.wait();
            if (!receipt) {
              results.push({
                to: dest,
                txHash: tx.hash,
                status: "failed: no receipt returned",
              });
              continue;
            }
            results.push({
              to: dest,
              txHash: receipt.hash,
              status: "success",
            });
          } catch (err: any) {
            results.push({
              to: dest,
              txHash: "",
              status: `failed: ${err.message}`,
            });
          }
        }

        const successful = results.filter((r) => r.status === "success").length;

        return mcpResult({
          action: "wallet_distribute_eth",
          chain: chain.name,
          from: from_address,
          totalSent: ethers.formatEther(amountWei * BigInt(successful)),
          successful,
          failed: results.length - successful,
          transactions: results,
          ...gate,
        });
      } catch (err: any) {
        return mcpResult({ error: `Distribution failed: ${err.message}`, suggestion: "Check that the source wallet has sufficient ETH and the chain RPC is accessible." }, true);
      }
    }
  );

  // ── wallet_consolidate_eth ──────────────────────────────────
  server.tool(
    "wallet_consolidate_eth",
    "Consolidate ETH from all managed wallets back to a single destination address. Leaves a small amount for gas.",
    {
      to_address: z.string().describe("Destination address to receive all consolidated ETH"),
      chain: z.string().optional().default("base").describe("Chain name (default: base)"),
      gas_reserve: z.string().optional().default("0.0001").describe("ETH to leave in each wallet for future gas (default: 0.0001)"),
      confirm: z.boolean().default(false).describe("Must be true to execute."),
      api_key: z.string().optional().describe("Premium API key for unlimited access. Free tier: 5/hour."),
    },
    async ({ to_address, chain: chainName, gas_reserve, confirm, api_key }) => {
      // Premium billing gate
      const billing = await validateApiKey(api_key, PRODUCT_ID);
      const gate = premiumGate("wallet_consolidate_eth", billing, api_key);
      if ("content" in gate) return gate;
      try {
        const chain = resolveChain(chainName);
        const provider = getProvider(chain);
        // Validate to_address
        if (!ethers.isAddress(to_address)) {
          return mcpResult({ error: "Invalid to_address.", suggestion: "Provide a valid 0x... EVM address." }, true);
        }

        const reserveWei = ethers.parseEther(gas_reserve);

        const all = listWallets();
        if (all.length === 0) {
          return mcpResult({ error: "No managed wallets to consolidate from.", suggestion: "Generate wallets with wallet_generate or import them with wallet_import first." }, true);
        }

        // Calculate available balances
        // Use allSettled so one RPC failure does not crash the entire batch
        const balanceResults = await Promise.allSettled(
          all.map(async (w) => {
            const bal = await provider.getBalance(w.address);
            const available = bal > reserveWei ? bal - reserveWei : 0n;
            return { address: w.address, label: w.label, balance: bal, available };
          })
        );

        const walletBalances = balanceResults
          .filter((r): r is PromiseFulfilledResult<{ address: string; label: string; balance: bigint; available: bigint }> => r.status === "fulfilled")
          .map((r) => r.value);

        const totalAvailable = walletBalances.reduce((sum: bigint, w) => sum + BigInt(w.available), 0n);

        if (!confirm) {
          return mcpResult({
            action: "wallet_consolidate_eth (SIMULATION)",
            to: to_address,
            walletsWithBalance: walletBalances.filter((w) => w.available > 0n).length,
            totalAvailable: ethers.formatEther(totalAvailable),
            gasReserve: gas_reserve,
            note: "Set confirm=true to execute consolidation.",
          });
        }

        const results: Array<{ from: string; amount: string; txHash: string; status: string }> = [];

        for (const wb of walletBalances) {
          if (wb.available <= 0n) continue;

          const signer = getWalletSigner(wb.address, provider);
          if (!signer) continue;

          try {
            // Estimate gas to leave exact reserve
            const gasPrice = (await provider.getFeeData()).gasPrice ?? ethers.parseUnits("0.1", "gwei");
            const gasLimit = 21000n;
            const gasCost = gasPrice * gasLimit;
            const sendAmount = BigInt(wb.available) - gasCost;

            if (sendAmount <= 0n) continue;

            const tx = await signer.sendTransaction({
              to: to_address,
              value: sendAmount,
              gasLimit,
            });
            const receipt = await tx.wait();
            if (!receipt) {
              results.push({
                from: wb.address,
                amount: ethers.formatEther(sendAmount),
                txHash: tx.hash,
                status: "failed: no receipt returned",
              });
              continue;
            }
            results.push({
              from: wb.address,
              amount: ethers.formatEther(sendAmount),
              txHash: receipt.hash,
              status: "success",
            });
          } catch (err: any) {
            results.push({
              from: wb.address,
              amount: ethers.formatEther(wb.available),
              txHash: "",
              status: `failed: ${err.message}`,
            });
          }
        }

        const totalSent = results
          .filter((r) => r.status === "success")
          .reduce((sum, r) => sum + parseFloat(r.amount), 0);

        return mcpResult({
          action: "wallet_consolidate_eth",
          chain: chain.name,
          to: to_address,
          totalConsolidated: totalSent.toFixed(8) + " ETH",
          successful: results.filter((r) => r.status === "success").length,
          failed: results.filter((r) => r.status !== "success").length,
          transactions: results,
          ...gate,
        });
      } catch (err: any) {
        return mcpResult({ error: `Consolidation failed: ${err.message}`, suggestion: "Check that managed wallets have ETH balances and the chain RPC is accessible." }, true);
      }
    }
  );
}
