/**
 * Wallet management tools — generate, list, import, check balances.
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
import { ERC20_ABI } from "../constants.js";
import { getProvider, resolveChain } from "../services/provider.js";
import {
  generateWallets,
  importWallet,
  listWallets,
  walletCount,
} from "../services/wallet-store.js";

const PRODUCT_ID = "prod_U7Ibjkw0hMHtzs";

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

export function registerWalletTools(server: McpServer) {
  // ── wallet_generate ──────────────────────────────────────────
  server.tool(
    "wallet_generate",
    "Generate new EVM wallets. Returns addresses only — private keys are stored securely server-side and never exposed.",
    {
      count: z.number().min(1).max(100).default(5).describe("Number of wallets to generate (1-100, default 5)"),
      label_prefix: z.string().optional().default("wallet").describe("Label prefix for generated wallets (e.g. 'sniper', 'holder')"),
      api_key: z.string().optional().describe("Premium API key for unlimited access. Free tier: 5/hour."),
    },
    async ({ count, label_prefix, api_key }) => {
      // Premium billing gate
      const billing = await validateApiKey(api_key, PRODUCT_ID);
      const gate = premiumGate("wallet_generate", billing, api_key);
      if ("content" in gate) return gate;

      const created = generateWallets(count, label_prefix);
      return mcpResult({
        action: "wallet_generate",
        walletsCreated: created.length,
        totalWallets: walletCount(),
        wallets: created,
        note: "Private keys are stored server-side. Use wallet_list to see all wallets.",
        ...gate,
      });
    }
  );

  // ── wallet_import ────────────────────────────────────────────
  server.tool(
    "wallet_import",
    "Import an existing wallet by private key. The key is stored securely server-side and never returned.",
    {
      private_key: z.string().describe("Private key (hex, with or without 0x prefix)"),
      label: z.string().optional().describe("Label for the wallet (e.g. 'main', 'treasury')"),
      api_key: z.string().optional().describe("Premium API key for unlimited access. Free tier: 5/hour."),
    },
    async ({ private_key, label, api_key }) => {
      // Premium billing gate
      const billing = await validateApiKey(api_key, PRODUCT_ID);
      const gate = premiumGate("wallet_import", billing, api_key);
      if ("content" in gate) return gate;

      const result = importWallet(private_key, label);
      if (!result) {
        return mcpResult({ error: "Invalid private key format.", suggestion: "Provide a valid hex private key (64 hex chars, with or without 0x prefix)." }, true);
      }
      return mcpResult({
        action: "wallet_import",
        wallet: result,
        totalWallets: walletCount(),
        ...gate,
      });
    }
  );

  // ── wallet_list ──────────────────────────────────────────────
  server.tool(
    "wallet_list",
    "List all managed wallets with their addresses and labels. No private keys are ever returned.",
    {},
    async () => {
      // Free tier rate limit
      const gate = freeGate("wallet_list");
      if ("content" in gate) return gate;

      const all = listWallets();
      return mcpResult({
        action: "wallet_list",
        count: all.length,
        wallets: all,
        ...gate,
      });
    }
  );

  // ── wallet_get_balances ──────────────────────────────────────
  server.tool(
    "wallet_get_balances",
    "Check ETH and token balances for a wallet address on any supported EVM chain. Checks all well-known tokens for the chain.",
    {
      address: z.string().describe("Wallet address to check"),
      chain: z.string().optional().default("base").describe("Chain name: base, ethereum, arbitrum (default: base)"),
    },
    async ({ address, chain: chainName }) => {
      // Free tier rate limit
      const gate = freeGate("wallet_get_balances");
      if ("content" in gate) return gate;

      try {
        const chain = resolveChain(chainName);
        const provider = getProvider(chain);

        if (!ethers.isAddress(address)) {
          return mcpResult({ error: "Invalid wallet address.", suggestion: "Provide a valid 0x... EVM address." }, true);
        }

        const [ethBalance, txCount] = await Promise.all([
          provider.getBalance(address),
          provider.getTransactionCount(address),
        ]);

        // Check all well-known tokens in parallel
        const tokenEntries = Object.entries(chain.tokens);
        const balanceResults = await Promise.allSettled(
          tokenEntries.map(async ([symbol, info]) => {
            const contract = new ethers.Contract(info.address, ERC20_ABI, provider);
            const bal: bigint = await contract.balanceOf(address);
            return {
              symbol,
              address: info.address,
              balance: ethers.formatUnits(bal, info.decimals),
              hasBalance: bal > 0n,
            };
          })
        );

        const tokens = balanceResults
          .filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled")
          .map((r) => r.value)
          .filter((t) => t.hasBalance);

        return mcpResult({
          address,
          chain: chain.name,
          chainId: chain.chainId,
          ethBalance: ethers.formatEther(ethBalance),
          transactionCount: txCount,
          tokenHoldings: tokens.map(({ symbol, address: addr, balance }) => ({ symbol, address: addr, balance })),
          tokensChecked: tokenEntries.map(([s]) => s),
          explorerUrl: `${chain.explorerUrl}/address/${address}`,
          ...gate,
        });
      } catch (err: any) {
        return mcpResult({ error: `Balance check failed: ${err.message}`, suggestion: "Check that the chain RPC is accessible." }, true);
      }
    }
  );

  // ── wallet_get_all_balances ──────────────────────────────────
  server.tool(
    "wallet_get_all_balances",
    "Check ETH balances for ALL managed wallets at once. Useful for seeing total portfolio value across wallet pool.",
    {
      chain: z.string().optional().default("base").describe("Chain name: base, ethereum, arbitrum (default: base)"),
    },
    async ({ chain: chainName }) => {
      // Free tier rate limit
      const gate = freeGate("wallet_get_all_balances");
      if ("content" in gate) return gate;

      try {
        const chain = resolveChain(chainName);
        const provider = getProvider(chain);
        const all = listWallets();

        if (all.length === 0) {
          return mcpResult({
            error: "No wallets in pool. Generate or import wallets first.",
            suggestion: "Use wallet_generate to create wallets.",
          }, true);
        }

        const balanceResults = await Promise.allSettled(
          all.map(async (w) => {
            const bal = await provider.getBalance(w.address);
            return {
              address: w.address,
              label: w.label,
              ethBalance: ethers.formatEther(bal),
            };
          })
        );

        const balances = balanceResults
          .filter((r): r is PromiseFulfilledResult<{ address: string; label: string; ethBalance: string }> => r.status === "fulfilled")
          .map((r) => r.value);

        const failed = balanceResults.filter((r) => r.status === "rejected").length;
        const totalEth = balances.reduce((sum, b) => sum + parseFloat(b.ethBalance), 0);

        return mcpResult({
          chain: chain.name,
          walletCount: balances.length,
          totalEthBalance: totalEth.toFixed(8),
          wallets: balances,
          ...(failed > 0 ? { failedQueries: failed } : {}),
          ...gate,
        });
      } catch (err: any) {
        return mcpResult({ error: `Batch balance check failed: ${err.message}`, suggestion: "Check that the chain RPC is accessible and try again." }, true);
      }
    }
  );
}
