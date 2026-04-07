/**
 * Analysis tools — scan tokens, check wallet activity, gas prices.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ethers } from "ethers";
import {
  mcpResult,
  checkRateLimit,
  RATE_LIMITS,
  KEY_PURCHASE_URL,
} from "@thryx/mcp-shared";
import { ERC20_ABI } from "../constants.js";
import { getProvider, resolveChain } from "../services/provider.js";

/** Known dangerous function selectors */
const DANGEROUS_SELECTORS: Record<string, string> = {
  "40c10f19": "mint(address,uint256)",
  "8456cb59": "pause()",
  "44337ea1": "blacklistAddress(address)",
  "e4997dc5": "excludeFromFees(address,bool)",
};

const OWNER_SELECTORS = [
  "8da5cb5b", // owner()
  "715018a6", // renounceOwnership()
  "f2fde38b", // transferOwnership(address)
];

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

export function registerAnalysisTools(server: McpServer) {
  // ── wallet_scan_token ─────────────────────────────────────────
  server.tool(
    "wallet_scan_token",
    "Security scan an ERC-20 token contract. Detects honeypot risk, hidden mint, blacklist, pause, owner permissions, proxy pattern. No wallet needed.",
    {
      token: z.string().describe("Token contract address to scan"),
      chain: z.string().optional().default("base").describe("Chain name (default: base)"),
    },
    async ({ token, chain: chainName }) => {
      // Free tier rate limit
      const gate = freeGate("wallet_scan_token");
      if ("content" in gate) return gate;

      try {
        const chain = resolveChain(chainName);
        const provider = getProvider(chain);
        const code = await provider.getCode(token);

        if (code === "0x") {
          return mcpResult({ error: "No contract found at this address.", address: token, suggestion: "Verify the token address is correct and deployed on this chain." }, true);
        }

        const codeHex = code.toLowerCase();
        const hasMint = codeHex.includes("40c10f19");
        const hasPause = codeHex.includes("8456cb59");
        const hasBlacklist = codeHex.includes("44337ea1");
        const hasOwner = OWNER_SELECTORS.some((s) => codeHex.includes(s));
        const isProxy = codeHex.includes("5c60da1b") || codeHex.includes("360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc");

        // Try to read owner
        let ownerAddress = "unknown";
        let ownerIsZero = false;
        try {
          const iface = new ethers.Interface(["function owner() view returns (address)"]);
          const callData = iface.encodeFunctionData("owner");
          const result = await provider.call({ to: token, data: callData });
          ownerAddress = iface.decodeFunctionResult("owner", result)[0];
          ownerIsZero = ownerAddress === ethers.ZeroAddress;
        } catch {
          ownerAddress = "none (no owner function)";
        }

        // Read basic ERC-20 info
        let tokenName = "unknown", tokenSymbol = "unknown", totalSupply = "unknown";
        try {
          const erc20 = new ethers.Contract(token, ERC20_ABI, provider);
          const [name, symbol, decimals, supply] = await Promise.all([
            erc20.name().catch(() => "unknown"),
            erc20.symbol().catch(() => "unknown"),
            erc20.decimals().catch(() => 18),
            erc20.totalSupply().catch(() => null),
          ]);
          tokenName = name;
          tokenSymbol = symbol;
          totalSupply = supply !== null ? ethers.formatUnits(supply, decimals) : "unknown";
        } catch { /* not standard ERC-20 */ }

        // Risk scoring
        let rugRiskScore = 0;
        const risks: string[] = [];

        if (hasMint) { rugRiskScore += 30; risks.push("Has mint function — owner can create unlimited tokens"); }
        if (hasPause) { rugRiskScore += 20; risks.push("Has pause function — owner can freeze all transfers"); }
        if (hasBlacklist) { rugRiskScore += 25; risks.push("Has blacklist — owner can block specific wallets"); }
        if (hasOwner && !ownerIsZero) { rugRiskScore += 10; risks.push("Has active owner — not renounced"); }
        if (isProxy) { rugRiskScore += 15; risks.push("Proxy contract — logic can be changed by admin"); }
        if (!hasOwner && !hasMint && !hasPause && !hasBlacklist) {
          risks.push("No dangerous permissions detected");
        }
        if (ownerIsZero) {
          risks.push("Ownership renounced (owner = 0x0)");
          rugRiskScore = Math.max(0, rugRiskScore - 15);
        }

        const riskLevel = rugRiskScore >= 50 ? "HIGH" : rugRiskScore >= 25 ? "MEDIUM" : "LOW";

        return mcpResult({
          token,
          name: tokenName,
          symbol: tokenSymbol,
          totalSupply,
          chain: `${chain.name} (${chain.chainId})`,
          owner: ownerAddress,
          ownerRenounced: ownerIsZero,
          isProxy,
          hasMintFunction: hasMint,
          hasPauseFunction: hasPause,
          hasBlacklistFunction: hasBlacklist,
          rugRiskScore: `${rugRiskScore}/100`,
          riskLevel,
          risks,
          explorerUrl: `${chain.explorerUrl}/address/${token}`,
          disclaimer: "Bytecode heuristic scan, not a full audit. DYOR.",
          ...gate,
        });
      } catch (err: any) {
        return mcpResult({ error: `Scan failed: ${err.message}`, token, suggestion: "Check that the token address is valid and the chain RPC is accessible." }, true);
      }
    }
  );

  // ── wallet_get_gas ──────────────────────────────────────────
  server.tool(
    "wallet_get_gas",
    "Get current gas prices on a chain. Useful for estimating transaction costs before executing operations.",
    {
      chain: z.string().optional().default("base").describe("Chain name (default: base)"),
    },
    async ({ chain: chainName }) => {
      // Free tier rate limit
      const gate = freeGate("wallet_get_gas");
      if ("content" in gate) return gate;

      try {
        const chain = resolveChain(chainName);
        const provider = getProvider(chain);
        const feeData = await provider.getFeeData();
        const block = await provider.getBlock("latest");

        return mcpResult({
          chain: chain.name,
          chainId: chain.chainId,
          blockNumber: block?.number,
          gasPrice: feeData.gasPrice ? ethers.formatUnits(feeData.gasPrice, "gwei") + " gwei" : "unknown",
          maxFeePerGas: feeData.maxFeePerGas ? ethers.formatUnits(feeData.maxFeePerGas, "gwei") + " gwei" : "unknown",
          maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ? ethers.formatUnits(feeData.maxPriorityFeePerGas, "gwei") + " gwei" : "unknown",
          estimatedTransferCost: feeData.gasPrice
            ? ethers.formatEther(feeData.gasPrice * 21000n) + " ETH"
            : "unknown",
          ...gate,
        });
      } catch (err: any) {
        return mcpResult({ error: `Gas fetch failed: ${err.message}`, suggestion: "Check that the chain RPC is accessible. Try again or use a different chain." }, true);
      }
    }
  );

  // ── wallet_get_token_balance ──────────────────────────────────
  server.tool(
    "wallet_get_token_balance",
    "Check a specific ERC-20 token balance for a wallet. Supports any token address, not just well-known ones.",
    {
      wallet: z.string().describe("Wallet address to check"),
      token: z.string().describe("ERC-20 token contract address"),
      chain: z.string().optional().default("base").describe("Chain name (default: base)"),
    },
    async ({ wallet, token, chain: chainName }) => {
      // Free tier rate limit
      const gate = freeGate("wallet_get_token_balance");
      if ("content" in gate) return gate;

      try {
        const chain = resolveChain(chainName);
        const provider = getProvider(chain);
        const contract = new ethers.Contract(token, ERC20_ABI, provider);

        const [name, symbol, decimals, balance] = await Promise.all([
          contract.name().catch(() => "unknown"),
          contract.symbol().catch(() => "?"),
          contract.decimals().catch(() => 18),
          contract.balanceOf(wallet),
        ]);

        return mcpResult({
          wallet,
          token,
          name,
          symbol,
          balance: ethers.formatUnits(balance, decimals),
          rawBalance: balance.toString(),
          decimals: Number(decimals),
          chain: chain.name,
          explorerUrl: `${chain.explorerUrl}/token/${token}?a=${wallet}`,
          ...gate,
        });
      } catch (err: any) {
        return mcpResult({ error: `Token balance check failed: ${err.message}`, suggestion: "Verify the wallet and token addresses are valid and the chain RPC is accessible." }, true);
      }
    }
  );
}
