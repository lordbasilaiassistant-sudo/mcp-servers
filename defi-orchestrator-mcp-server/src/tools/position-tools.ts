/**
 * Position management tools — check DeFi positions and yield opportunities.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ethers } from "ethers";
import {
  mcpResult,
  mcpError,
  getProvider,
  CHAINS,
  checkRateLimit,
  RATE_LIMITS,
  KEY_PURCHASE_URL,
} from "@thryx/mcp-shared";
import {
  resolveChain,
  resolveToken,
  getAaveAccountHealth,
  getAaveUserReserve,
  getAaveReserveTokens,
  CONTRACTS,
  ERC20_ABI,
  AAVE_DATA_PROVIDER_ABI,
  MULTICALL3_ABI,
  type LendingPosition,
  type AccountHealth,
  type YieldPool,
} from "../services/protocols.js";

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

export function registerPositionTools(server: McpServer) {
  // ── defi_check_positions ──────────────────────────────────────────────
  server.tool(
    "defi_check_positions",
    "Check ALL DeFi positions for a wallet in one call. Returns lending positions (Aave: supplied, borrowed, health factor, liquidation risk), token balances, and an overall portfolio summary with risk assessment. Tells the agent exactly what actions to consider.",
    {
      wallet: z
        .string()
        .describe("Wallet address to check (0x...)"),
      chain: z
        .string()
        .optional()
        .describe("Chain: 'base' (default), 'ethereum', 'arbitrum'"),
      protocols: z
        .array(z.string())
        .optional()
        .describe("Filter to specific protocols: ['aave', 'uniswap', 'aerodrome']. Default: all."),
    },
    async ({ wallet, chain, protocols }) => {
      // Free tier rate limit
      const gate = freeGate("defi_check_positions");
      if ("content" in gate) return gate;

      if (!ethers.isAddress(wallet)) {
        return mcpError("Invalid wallet address.", "Provide a valid 0x... Ethereum address.");
      }

      const chainConfig = resolveChain(chain);
      const provider = getProvider(chainConfig);
      const filterProtocols = protocols?.map((p: string) => p.toLowerCase()) ?? [];
      const checkAll = filterProtocols.length === 0;

      const result: Record<string, unknown> = {
        action: "defi_check_positions",
        wallet,
        chain: chainConfig.name,
      };

      // ── ETH balance ──────────────────────────────────────────────
      const ethBalance = await (provider as any).getBalance(wallet);
      result.ethBalance = ethers.formatEther(ethBalance);

      // ── Token balances (well-known tokens via Multicall3) ────────
      const tokenEntries = Object.entries(chainConfig.tokens);
      if (tokenEntries.length > 0 && chainConfig.chainId === 8453) {
        try {
          const mc3 = new ethers.Contract(CONTRACTS.base.multicall3, MULTICALL3_ABI, provider as any);
          const iface = new ethers.Interface(ERC20_ABI);

          const calls = tokenEntries.map(([, t]) => ({
            target: t.address,
            allowFailure: true,
            callData: iface.encodeFunctionData("balanceOf", [wallet]),
          }));

          const mcResults = await mc3.aggregate3.staticCall(calls);
          const tokenBalances: Array<{ symbol: string; address: string; balance: string }> = [];

          for (let i = 0; i < tokenEntries.length; i++) {
            const [symbol, tokenData] = tokenEntries[i];
            const r = mcResults[i];
            if (r.success) {
              const decoded = iface.decodeFunctionResult("balanceOf", r.returnData);
              const bal = decoded[0] as bigint;
              if (bal > 0n) {
                tokenBalances.push({
                  symbol,
                  address: tokenData.address,
                  balance: ethers.formatUnits(bal, tokenData.decimals),
                });
              }
            }
          }

          result.tokenBalances = tokenBalances;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          process.stderr.write(`[positions] Multicall3 token balance check failed: ${msg}\n`);
          result.tokenBalances = [];
          result.tokenBalanceError = "Failed to fetch token balances via Multicall3";
        }
      }

      // ── Aave V3 positions ────────────────────────────────────────
      if (checkAll || filterProtocols.includes("aave")) {
        const health = await getAaveAccountHealth(wallet, chainConfig);

        if (health) {
          const hasPosition =
            parseFloat(health.totalCollateralUsd) > 0 || parseFloat(health.totalDebtUsd) > 0;

          if (hasPosition) {
            // Get per-asset breakdown
            const reserveTokens = await getAaveReserveTokens(chainConfig);
            const lendingPositions: LendingPosition[] = [];

            for (const token of reserveTokens) {
              const pos = await getAaveUserReserve(token.address, wallet, chainConfig);
              if (pos && (BigInt(pos.supplied) > 0n || BigInt(pos.borrowed) > 0n)) {
                lendingPositions.push({
                  ...pos,
                  asset: token.symbol,
                });
              }
            }

            result.aave = {
              health,
              positions: lendingPositions,
              riskSummary: getRiskSummary(health),
            };
          } else {
            result.aave = { status: "no_positions", health };
          }
        } else {
          result.aave = { status: "unavailable", note: "Could not fetch Aave data" };
        }
      }

      // ── Portfolio summary ────────────────────────────────────────
      const suggestions: string[] = [];
      const aaveData = result.aave as Record<string, unknown> | undefined;

      if (aaveData?.health) {
        const health = aaveData.health as AccountHealth;
        const hf = parseFloat(health.healthFactor);
        if (!isNaN(hf) && hf < 1.5 && hf > 0) {
          suggestions.push(`WARNING: Aave health factor is ${hf.toFixed(2)} — risk of liquidation. Consider repaying debt or adding collateral.`);
        }
        if (parseFloat(health.availableBorrowsUsd) > 100) {
          suggestions.push(`You have $${parseFloat(health.availableBorrowsUsd).toFixed(2)} available to borrow on Aave.`);
        }
      }

      if (parseFloat(result.ethBalance as string) < 0.001) {
        suggestions.push("ETH balance is very low — you may not have enough for gas fees.");
      }

      result.suggestions = suggestions.length > 0 ? suggestions : ["Portfolio looks healthy. No urgent actions needed."];
      result.explorerUrl = `${chainConfig.explorerUrl}/address/${wallet}`;

      return mcpResult({ ...result, ...gate });
    },
  );

  // ── defi_get_yields ───────────────────────────────────────────────────
  server.tool(
    "defi_get_yields",
    "Get best yield opportunities across DeFi protocols on Base. Returns top pools by APY with TVL, risk rating, and direct comparisons. Helps agents recommend where to deploy capital.",
    {
      token: z
        .string()
        .optional()
        .describe("Filter by token symbol (e.g. 'ETH', 'USDC'). Omit for all."),
      chain: z
        .string()
        .optional()
        .describe("Chain: 'base' (default)"),
      min_tvl: z
        .number()
        .optional()
        .default(10000)
        .describe("Minimum TVL in USD to include. Default: 10000"),
    },
    async ({ token, chain, min_tvl }) => {
      // Free tier rate limit
      const gate = freeGate("defi_get_yields");
      if ("content" in gate) return gate;

      const chainConfig = resolveChain(chain);

      // ── Aave V3 lending yields ───────────────────────────────────
      const aaveYields: YieldPool[] = [];

      try {
        const provider = getProvider(chainConfig);
        if (chainConfig.chainId === 8453) {
          const dataProvider = new ethers.Contract(
            CONTRACTS.base.aavePoolDataProvider,
            AAVE_DATA_PROVIDER_ABI,
            provider as any,
          );

          const reserveTokens = await dataProvider.getAllReservesTokens();

          for (const [symbol, addr] of reserveTokens as Array<[string, string]>) {
            // Filter by token if specified
            if (token && symbol.toUpperCase() !== token.toUpperCase()) continue;

            try {
              const data = await dataProvider.getReserveData(addr);
              const supplyRate = Number(ethers.formatUnits(data[5], 27)) * 100;
              const totalSupplied = data[2] as bigint;

              // Look up token decimals for proper formatting
              const tokenInfo = resolveToken(symbol, chainConfig);
              const decimals = tokenInfo?.decimals ?? 18;
              const formattedTvl = ethers.formatUnits(totalSupplied, decimals);

              if (supplyRate > 0) {
                aaveYields.push({
                  protocol: "Aave V3",
                  pool: `${symbol} Lending`,
                  tokenA: symbol,
                  tokenB: "",
                  apy: supplyRate,
                  apyBase: supplyRate,
                  apyReward: 0,
                  tvl: formattedTvl,
                  stable: true,
                  riskRating: "low",
                });
              }
            } catch {
              // Skip tokens that fail
            }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[yields] Aave yield fetch failed: ${msg}\n`);
      }

      // ── Static well-known Aerodrome pools (top pools by TVL) ─────
      // WARNING: These are hardcoded estimates, NOT live on-chain data.
      // In production, these should be fetched from Aerodrome's subgraph/API.
      const AERODROME_DATA_STALE_DISCLAIMER = "ESTIMATED — Aerodrome APY/TVL data is hardcoded and may be stale. Verify current rates at app.aerodrome.finance before depositing.";
      const aerodromeYields: YieldPool[] = [
        {
          protocol: "Aerodrome (estimated)",
          pool: "WETH/USDC (volatile)",
          tokenA: "WETH",
          tokenB: "USDC",
          apy: 15.2,
          apyBase: 5.1,
          apyReward: 10.1,
          tvl: "45000000",
          stable: false,
          riskRating: "medium",
        },
        {
          protocol: "Aerodrome (estimated)",
          pool: "USDC/USDbC (stable)",
          tokenA: "USDC",
          tokenB: "USDbC",
          apy: 4.5,
          apyBase: 2.0,
          apyReward: 2.5,
          tvl: "30000000",
          stable: true,
          riskRating: "low",
        },
        {
          protocol: "Aerodrome (estimated)",
          pool: "WETH/AERO (volatile)",
          tokenA: "WETH",
          tokenB: "AERO",
          apy: 42.0,
          apyBase: 12.0,
          apyReward: 30.0,
          tvl: "8000000",
          stable: false,
          riskRating: "high",
        },
        {
          protocol: "Aerodrome (estimated)",
          pool: "USDC/DAI (stable)",
          tokenA: "USDC",
          tokenB: "DAI",
          apy: 3.8,
          apyBase: 1.5,
          apyReward: 2.3,
          tvl: "15000000",
          stable: true,
          riskRating: "low",
        },
      ];

      // Filter by token if specified
      let filteredAerodrome = aerodromeYields;
      if (token) {
        const upper = token.toUpperCase();
        filteredAerodrome = aerodromeYields.filter(
          (y) => y.tokenA.toUpperCase() === upper || y.tokenB.toUpperCase() === upper,
        );
      }

      // Combine and sort by APY
      const allYields = [...aaveYields, ...filteredAerodrome]
        .filter((y) => parseFloat(y.tvl) >= (min_tvl ?? 0))
        .sort((a, b) => b.apy - a.apy);

      // Add comparisons
      const comparisons: string[] = [];
      if (allYields.length >= 2) {
        const top = allYields[0];
        const runner = allYields[1];
        comparisons.push(
          `${top.pool} (${top.protocol}) gives ${top.apy.toFixed(1)}% APY ` +
          `${top.riskRating === "high" ? "but is higher risk" : "with " + top.riskRating + " risk"} ` +
          `vs ${runner.pool} (${runner.protocol}) at ${runner.apy.toFixed(1)}% APY ` +
          `with ${runner.riskRating} risk.`,
        );
      }

      return mcpResult({
        action: "defi_get_yields",
        chain: chainConfig.name,
        filter: token ?? "all tokens",
        minTvl: min_tvl,
        yields: allYields.map((y) => ({
          protocol: y.protocol,
          pool: y.pool,
          tokens: [y.tokenA, y.tokenB].filter(Boolean).join("/"),
          apy: `${y.apy.toFixed(2)}%`,
          apyBreakdown: {
            base: `${y.apyBase.toFixed(2)}%`,
            rewards: `${y.apyReward.toFixed(2)}%`,
          },
          tvl: y.tvl,
          stable: y.stable,
          riskRating: y.riskRating,
        })),
        comparisons,
        note: AERODROME_DATA_STALE_DISCLAIMER + " Aave rates are fetched live from on-chain.",
        ...gate,
      });
    },
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getRiskSummary(health: AccountHealth): {
  level: string;
  message: string;
} {
  const hf = parseFloat(health.healthFactor);

  if (health.healthFactor === "Infinity" || isNaN(hf)) {
    return { level: "safe", message: "No debt — no liquidation risk." };
  }

  if (hf < 1.0) {
    return {
      level: "CRITICAL",
      message: `Health factor ${hf.toFixed(4)} — LIQUIDATION IMMINENT. Repay debt immediately.`,
    };
  }
  if (hf < 1.2) {
    return {
      level: "DANGER",
      message: `Health factor ${hf.toFixed(4)} — very close to liquidation. Add collateral or repay debt NOW.`,
    };
  }
  if (hf < 1.5) {
    return {
      level: "WARNING",
      message: `Health factor ${hf.toFixed(4)} — getting risky. Consider adding collateral or reducing debt.`,
    };
  }
  if (hf < 2.0) {
    return {
      level: "MODERATE",
      message: `Health factor ${hf.toFixed(4)} — acceptable but monitor closely.`,
    };
  }

  return {
    level: "SAFE",
    message: `Health factor ${hf.toFixed(4)} — healthy position with good safety margin.`,
  };
}
