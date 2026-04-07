/**
 * Strategy tools — simulate, execute, and quick-swap DeFi strategies.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ethers } from "ethers";
import {
  mcpResult,
  mcpError,
  getProvider,
  getSigner,
  CHAINS,
  validateApiKey,
  checkRateLimit,
  RATE_LIMITS,
  KEY_PURCHASE_URL,
} from "@thryx/mcp-shared";
import { simulateStrategy, getCachedStrategy } from "../services/simulator.js";
import {
  resolveChain,
  resolveToken,
  getBestSwapQuote,
  CONTRACTS,
  UNISWAP_ROUTER_ABI,
  AERODROME_ROUTER_ABI,
  ERC20_ABI,
  AAVE_POOL_ABI,
} from "../services/protocols.js";

const PRODUCT_ID = "prod_U6Z0Ci7PlXpSD3";

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

export function registerStrategyTools(server: McpServer) {
  // ── defi_simulate_strategy ────────────────────────────────────────────
  server.tool(
    "defi_simulate_strategy",
    "Simulate a multi-step DeFi strategy WITHOUT executing. Takes natural language like 'swap 1 ETH to USDC' or 'provide ETH/USDC liquidity on Aerodrome'. Returns step-by-step plan with gas estimates, risk assessment, and simulated outcome. Use the returned strategy_id with defi_execute_strategy to execute.",
    {
      strategy: z
        .string()
        .describe(
          "Natural language strategy description, e.g. 'swap 1 ETH to USDC on Uniswap', 'provide ETH/USDC liquidity', 'supply 2 ETH to Aave'",
        ),
      params: z
        .record(z.string())
        .optional()
        .default({})
        .describe(
          "Optional explicit parameters to override parsed values: tokenIn, tokenOut, amount, tokenA, tokenB, etc.",
        ),
      chain: z
        .string()
        .optional()
        .describe("Chain name: 'base' (default), 'ethereum', 'arbitrum'"),
    },
    async ({ strategy, params, chain }) => {
      // Free tier rate limit
      const gate = freeGate("defi_simulate_strategy");
      if ("content" in gate) return gate;

      try {
        const plan = await simulateStrategy(strategy, params ?? {}, chain);
        return mcpResult({
          action: "defi_simulate_strategy",
          ...plan,
          ...gate,
          nextStep: `To execute this strategy, call defi_execute_strategy with strategy_id="${plan.strategyId}" and confirm=true`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return mcpError(msg, "Check token symbols and amounts. Supported tokens: ETH, WETH, USDC, DAI, AERO, etc.");
      }
    },
  );

  // ── defi_execute_strategy ─────────────────────────────────────────────
  server.tool(
    "defi_execute_strategy",
    "Execute a previously simulated DeFi strategy on-chain. REQUIRES confirm=true as a safety rail. Executes steps sequentially, reporting each transaction. Stops immediately if any step fails. Returns all tx hashes, gas used, and final state.",
    {
      strategy_id: z
        .string()
        .describe("Strategy ID from a previous defi_simulate_strategy call"),
      confirm: z
        .boolean()
        .describe("Must be true to execute. Safety rail to prevent accidental execution."),
      slippage_bps: z
        .number()
        .min(1)
        .max(500)
        .optional()
        .default(100)
        .describe("Max slippage in basis points (100 = 1%). Default: 100"),
      api_key: z
        .string()
        .describe("Premium API key for execution access"),
    },
    async ({ strategy_id, confirm, slippage_bps, api_key }) => {
      // Premium billing gate
      const billing = await validateApiKey(api_key, PRODUCT_ID);
      const gate = premiumGate("defi_execute_strategy", billing, api_key);
      if ("content" in gate) return gate;

      // Safety rail
      if (!confirm) {
        return mcpError(
          "Execution not confirmed.",
          "Set confirm=true to execute the strategy. This is a safety rail to prevent accidental on-chain transactions.",
        );
      }

      // Retrieve cached strategy
      const plan = getCachedStrategy(strategy_id);
      if (!plan) {
        return mcpError(
          `Strategy ${strategy_id} not found.`,
          "Run defi_simulate_strategy first to create a plan, then use the returned strategy_id.",
        );
      }

      // Check for signer
      const chain = resolveChain(plan.chain.toLowerCase());
      const signer = getSigner(chain);
      if (!signer) {
        return mcpError(
          "No signer available.",
          "Set DEPLOYER_PRIVATE_KEY environment variable to enable on-chain execution.",
        );
      }

      const results: Array<{
        step: number;
        action: string;
        status: "success" | "failed" | "skipped";
        txHash?: string;
        gasUsed?: string;
        error?: string;
        explorerUrl?: string;
      }> = [];

      let totalGasUsed = 0n;
      const slippageMultiplier = 10000n - BigInt(slippage_bps ?? 100);

      for (const step of plan.steps) {
        try {
          let tx: ethers.TransactionResponse | null = null;

          if (step.action === "approve" && step.approvalTarget && step.tokenIn) {
            const tokenInfo = resolveToken(step.tokenIn, chain);
            if (!tokenInfo) throw new Error(`Cannot resolve token: ${step.tokenIn}`);

            const token = new ethers.Contract(tokenInfo.address, ERC20_ABI, signer as any);
            tx = await token.approve(step.approvalTarget, ethers.MaxUint256);
          } else if (step.action === "swap" && step.tokenIn && step.tokenOut) {
            const tokenInInfo = resolveToken(step.tokenIn, chain);
            const tokenOutInfo = resolveToken(step.tokenOut, chain);
            if (!tokenInInfo || !tokenOutInfo) throw new Error(`Cannot resolve swap tokens`);

            const amountIn = ethers.parseUnits(step.amount ?? "0", tokenInInfo.decimals);

            // Get fresh quote
            const { best } = await getBestSwapQuote(tokenInInfo.address, tokenOutInfo.address, amountIn, chain);
            if (!best) throw new Error("No swap route available");

            const minOut = (BigInt(best.amountOut) * slippageMultiplier) / 10000n;

            if (best.protocol === "Aerodrome") {
              const router = new ethers.Contract(CONTRACTS.base.aerodromeRouter, AERODROME_ROUTER_ABI, signer as any);
              const routes = [{
                from: tokenInInfo.address,
                to: tokenOutInfo.address,
                stable: false,
                factory: CONTRACTS.base.aerodromeFactory,
              }];
              const deadline = Math.floor(Date.now() / 1000) + 1200;
              tx = await router.swapExactTokensForTokens(amountIn, minOut, routes, await signer.getAddress(), deadline);
            } else {
              const router = new ethers.Contract(CONTRACTS.base.uniswapRouterV2, UNISWAP_ROUTER_ABI, signer as any);
              const swapParams = {
                tokenIn: tokenInInfo.address,
                tokenOut: tokenOutInfo.address,
                fee: 3000,
                recipient: await signer.getAddress(),
                amountIn,
                amountOutMinimum: minOut,
                sqrtPriceLimitX96: 0n,
              };
              tx = await router.exactInputSingle(swapParams);
            }
          } else if (step.action === "supply" || step.action === "borrow" || step.action === "repay" || step.action === "withdraw") {
            const pool = new ethers.Contract(CONTRACTS.base.aavePool, AAVE_POOL_ABI, signer as any);
            const walletAddr = await signer.getAddress();

            if (step.action === "supply" && step.tokenIn) {
              const tokenInfo = resolveToken(step.tokenIn, chain);
              if (!tokenInfo) throw new Error(`Cannot resolve: ${step.tokenIn}`);
              const amount = ethers.parseUnits(step.amount ?? "0", tokenInfo.decimals);
              tx = await pool.supply(tokenInfo.address, amount, walletAddr, 0);
            } else if (step.action === "borrow" && step.tokenOut) {
              const tokenInfo = resolveToken(step.tokenOut, chain);
              if (!tokenInfo) throw new Error(`Cannot resolve: ${step.tokenOut}`);
              const amount = ethers.parseUnits(step.amount ?? "0", tokenInfo.decimals);
              tx = await pool.borrow(tokenInfo.address, amount, 2, 0, walletAddr);
            } else if (step.action === "repay" && step.tokenIn) {
              const tokenInfo = resolveToken(step.tokenIn, chain);
              if (!tokenInfo) throw new Error(`Cannot resolve: ${step.tokenIn}`);
              const amount = step.amount === "all"
                ? ethers.MaxUint256
                : ethers.parseUnits(step.amount ?? "0", tokenInfo.decimals);
              tx = await pool.repay(tokenInfo.address, amount, 2, walletAddr);
            } else if (step.action === "withdraw" && step.tokenOut) {
              const tokenInfo = resolveToken(step.tokenOut, chain);
              if (!tokenInfo) throw new Error(`Cannot resolve: ${step.tokenOut}`);
              tx = await pool.withdraw(tokenInfo.address, ethers.MaxUint256, walletAddr);
            }
          }

          if (tx) {
            const receipt = await tx.wait();
            const gasUsed = receipt?.gasUsed ?? 0n;
            totalGasUsed += gasUsed;

            results.push({
              step: step.step,
              action: step.action,
              status: "success",
              txHash: tx.hash,
              gasUsed: gasUsed.toString(),
              explorerUrl: `${chain.explorerUrl}/tx/${tx.hash}`,
            });
          } else {
            results.push({
              step: step.step,
              action: step.action,
              status: "skipped",
              error: "No transaction generated for this step type",
            });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          results.push({
            step: step.step,
            action: step.action,
            status: "failed",
            error: msg,
          });

          // Stop on first failure — no silent failures
          return mcpResult({
            action: "defi_execute_strategy",
            strategyId: strategy_id,
            status: "partial_failure",
            completedSteps: results.filter((r) => r.status === "success").length,
            totalSteps: plan.steps.length,
            failedAt: step.step,
            results,
            totalGasUsed: totalGasUsed.toString(),
            error: `Step ${step.step} (${step.action}) failed: ${msg}`,
            suggestion: "Review the error and re-simulate if needed. Completed steps are already on-chain.",
          });
        }
      }

      return mcpResult({
        action: "defi_execute_strategy",
        strategyId: strategy_id,
        status: "success",
        completedSteps: results.length,
        totalSteps: plan.steps.length,
        results,
        totalGasUsed: totalGasUsed.toString(),
        chain: plan.chain,
        ...gate,
      });
    },
  );

  // ── defi_quick_swap ───────────────────────────────────────────────────
  server.tool(
    "defi_quick_swap",
    "Quick single token swap with best execution across DEXes (Uniswap V3, Aerodrome). Compares quotes from multiple routes and executes on the best one. Returns tx hash, amounts, price impact, and gas used.",
    {
      from_token: z
        .string()
        .describe("Token to sell: symbol (ETH, USDC, WETH) or contract address"),
      to_token: z
        .string()
        .describe("Token to buy: symbol (ETH, USDC, WETH) or contract address"),
      amount: z
        .string()
        .describe("Amount to swap in human-readable form (e.g. '1.5' for 1.5 ETH)"),
      chain: z
        .string()
        .optional()
        .describe("Chain: 'base' (default), 'ethereum', 'arbitrum'"),
      slippage_bps: z
        .number()
        .min(1)
        .max(500)
        .optional()
        .default(100)
        .describe("Max slippage in basis points (100 = 1%). Default: 100"),
      confirm: z
        .boolean()
        .optional()
        .default(false)
        .describe("Set true to execute. False returns quote comparison only."),
      api_key: z
        .string()
        .optional()
        .describe("Premium API key for execution"),
    },
    async ({ from_token, to_token, amount, chain, slippage_bps, confirm, api_key }) => {
      // Premium billing gate
      const billing = await validateApiKey(api_key, PRODUCT_ID);
      const gate = premiumGate("defi_quick_swap", billing, api_key);
      if ("content" in gate) return gate;

      const chainConfig = resolveChain(chain);
      const tokenIn = resolveToken(from_token, chainConfig);
      const tokenOut = resolveToken(to_token, chainConfig);

      if (!tokenIn) {
        return mcpError(`Unknown token: ${from_token}`, `Use a known symbol (ETH, USDC, WETH, DAI, AERO) or a contract address.`);
      }
      if (!tokenOut) {
        return mcpError(`Unknown token: ${to_token}`, `Use a known symbol (ETH, USDC, WETH, DAI, AERO) or a contract address.`);
      }

      const amountWei = ethers.parseUnits(amount, tokenIn.decimals);
      const { best, quotes } = await getBestSwapQuote(tokenIn.address, tokenOut.address, amountWei, chainConfig);

      if (!best) {
        return mcpError("No swap route found.", "Check that the token pair has liquidity on Base.");
      }

      const quoteComparison = quotes.map((q) => ({
        protocol: q.protocol,
        amountOut: ethers.formatUnits(BigInt(q.amountOut), tokenOut.decimals),
        priceImpact: `${q.priceImpact.toFixed(4)}%`,
        fee: `${q.fee}%`,
        route: q.route,
      }));

      // Quote-only mode
      if (!confirm) {
        return mcpResult({
          action: "defi_quick_swap",
          mode: "quote",
          from: `${amount} ${tokenIn.symbol}`,
          to: `${ethers.formatUnits(BigInt(best.amountOut), tokenOut.decimals)} ${tokenOut.symbol}`,
          bestRoute: best.protocol,
          priceImpact: `${best.priceImpact.toFixed(4)}%`,
          quotes: quoteComparison,
          suggestion: `Set confirm=true to execute this swap. Note: execution requires a premium api_key parameter. Get one at ${KEY_PURCHASE_URL}`,
          ...gate,
        });
      }

      // Execute
      const signer = getSigner(chainConfig);
      if (!signer) {
        return mcpError("No signer.", "Set DEPLOYER_PRIVATE_KEY to execute swaps.");
      }

      const slippageMul = 10000n - BigInt(slippage_bps ?? 100);
      const minOut = (BigInt(best.amountOut) * slippageMul) / 10000n;

      try {
        // Approve first
        if (from_token.toUpperCase() !== "ETH") {
          const tokenContract = new ethers.Contract(tokenIn.address, ERC20_ABI, signer as any);
          const currentAllowance = await tokenContract.allowance(
            await signer.getAddress(),
            best.protocol === "Aerodrome" ? CONTRACTS.base.aerodromeRouter : CONTRACTS.base.uniswapRouterV2,
          );
          if ((currentAllowance as bigint) < amountWei) {
            const approveTx = await tokenContract.approve(
              best.protocol === "Aerodrome" ? CONTRACTS.base.aerodromeRouter : CONTRACTS.base.uniswapRouterV2,
              ethers.MaxUint256,
            );
            await approveTx.wait();
          }
        }

        let tx: ethers.TransactionResponse;
        if (best.protocol === "Aerodrome") {
          const router = new ethers.Contract(CONTRACTS.base.aerodromeRouter, AERODROME_ROUTER_ABI, signer as any);
          const routes = [{
            from: tokenIn.address,
            to: tokenOut.address,
            stable: false,
            factory: CONTRACTS.base.aerodromeFactory,
          }];
          const deadline = Math.floor(Date.now() / 1000) + 1200;
          tx = await router.swapExactTokensForTokens(amountWei, minOut, routes, await signer.getAddress(), deadline);
        } else {
          const router = new ethers.Contract(CONTRACTS.base.uniswapRouterV2, UNISWAP_ROUTER_ABI, signer as any);
          tx = await router.exactInputSingle({
            tokenIn: tokenIn.address,
            tokenOut: tokenOut.address,
            fee: 3000,
            recipient: await signer.getAddress(),
            amountIn: amountWei,
            amountOutMinimum: minOut,
            sqrtPriceLimitX96: 0n,
          });
        }

        const receipt = await tx.wait();

        return mcpResult({
          action: "defi_quick_swap",
          status: "success",
          from: `${amount} ${tokenIn.symbol}`,
          to: `${ethers.formatUnits(BigInt(best.amountOut), tokenOut.decimals)} ${tokenOut.symbol} (estimated)`,
          protocol: best.protocol,
          priceImpact: `${best.priceImpact.toFixed(4)}%`,
          txHash: tx.hash,
          gasUsed: receipt?.gasUsed?.toString() ?? "unknown",
          explorerUrl: `${chainConfig.explorerUrl}/tx/${tx.hash}`,
          quotes: quoteComparison,
          ...gate,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return mcpError(`Swap failed: ${msg}`, "Check token balances and approvals. The quote may have expired.");
      }
    },
  );
}
