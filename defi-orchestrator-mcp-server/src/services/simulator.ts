/**
 * Strategy simulation engine.
 *
 * Parses natural language strategies into executable step arrays,
 * estimates gas, calculates expected outputs using on-chain quotes,
 * and assesses risk.
 */

import { ethers } from "ethers";
import { type ChainConfig } from "@thryx/mcp-shared";
import {
  resolveToken,
  resolveChain,
  getBestSwapQuote,
  getAaveAccountHealth,
  CONTRACTS,
  type SwapQuote,
} from "./protocols.js";
import {
  type StrategyPlan,
  type StrategyStep,
  type RiskAssessment,
  type StrategyType,
  matchStrategy,
  generateStrategyId,
  STRATEGY_TEMPLATES,
} from "./strategies.js";

// ── In-memory strategy cache (for execute to reference) ──────────────────────

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const CACHE_MAX_SIZE = 1000;
const strategyCache = new Map<string, { plan: StrategyPlan; expiresAt: number }>();

export function getCachedStrategy(id: string): StrategyPlan | null {
  const entry = strategyCache.get(id);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    strategyCache.delete(id);
    return null;
  }
  return entry.plan;
}

function cacheStrategy(plan: StrategyPlan): void {
  // Evict oldest if full
  if (strategyCache.size >= CACHE_MAX_SIZE) {
    const firstKey = strategyCache.keys().next().value;
    if (firstKey) strategyCache.delete(firstKey);
  }
  strategyCache.set(plan.strategyId, { plan, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ── Supported Protocols ──────────────────────────────────────────────────────

const SUPPORTED_PROTOCOLS = new Set([
  "uniswap", "uniswap v3", "uniswapv3",
  "aave", "aave v3", "aavev3",
  "aerodrome",
]);

/**
 * Check if the user specified a protocol name in their strategy text.
 * Returns the unsupported protocol name if one is found, or null if all are supported.
 */
function checkForUnsupportedProtocol(strategyText: string): string | null {
  const lower = strategyText.toLowerCase();

  // Match "on <protocol>" or "via <protocol>" or "using <protocol>" patterns
  const protocolPatterns = [
    /\bon\s+([a-z][a-z0-9\s]*?)(?:\s+(?:v\d+))?\s*$/i,
    /\bvia\s+([a-z][a-z0-9\s]*?)(?:\s+(?:v\d+))?\s*$/i,
    /\busing\s+([a-z][a-z0-9\s]*?)(?:\s+(?:v\d+))?\s*$/i,
    /\bon\s+([a-z][a-z0-9\s]*?)(?:\s+(?:v\d+))?(?:\s*,|\s+(?:and|then|after))/i,
    /\bvia\s+([a-z][a-z0-9\s]*?)(?:\s+(?:v\d+))?(?:\s*,|\s+(?:and|then|after))/i,
    /\busing\s+([a-z][a-z0-9\s]*?)(?:\s+(?:v\d+))?(?:\s*,|\s+(?:and|then|after))/i,
  ];

  for (const pattern of protocolPatterns) {
    const match = lower.match(pattern);
    if (match) {
      const proto = match[1].trim();
      // Skip common tokens/words that aren't protocol names
      if (["eth", "usdc", "weth", "dai", "aero", "base", "it"].includes(proto)) continue;
      if (!SUPPORTED_PROTOCOLS.has(proto)) {
        return proto;
      }
    }
  }

  return null;
}

// ── Natural Language Parsing ─────────────────────────────────────────────────

/** Connectors that separate multi-step strategy phrases */
const MULTI_STEP_CONNECTORS = /\s*(?:,?\s*(?:then|and\s+then|after\s+that|afterwards|next|followed\s+by)\s+)/i;

interface ParsedIntent {
  type: StrategyType;
  params: Record<string, string>;
}

/**
 * Parse a single-action strategy segment into structured intent.
 * Handles common DeFi phrases and extracts tokens + amounts.
 */
function parseSingleIntent(
  strategyText: string,
  params: Record<string, unknown>,
): ParsedIntent | null {
  const type = matchStrategy(strategyText);
  if (!type) return null;

  const lower = strategyText.toLowerCase();
  const extracted: Record<string, string> = {};

  // Extract amounts: "1 ETH", "100 USDC", "0.5 WETH"
  const amountRegex = /(\d+\.?\d*)\s+([A-Za-z]+)/g;
  const amounts: Array<{ amount: string; token: string }> = [];
  let match;
  while ((match = amountRegex.exec(strategyText)) !== null) {
    amounts.push({ amount: match[1], token: match[2].toUpperCase() });
  }

  // Merge explicit params
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "string") extracted[k] = v;
    if (typeof v === "number") extracted[k] = v.toString();
  }

  switch (type) {
    case "SWAP": {
      // "Swap 1 ETH to USDC" / "Buy USDC with 1 ETH"
      if (amounts.length >= 1) {
        extracted.amount = extracted.amount ?? amounts[0].amount;
        extracted.tokenIn = extracted.tokenIn ?? amounts[0].token;
      }
      // Look for "to X" or "for X"
      const toMatch = lower.match(/(?:to|for|into)\s+(\w+)/);
      if (toMatch) {
        extracted.tokenOut = extracted.tokenOut ?? toMatch[1].toUpperCase();
      }
      if (amounts.length >= 2 && !extracted.tokenOut) {
        extracted.tokenOut = amounts[1].token;
      }
      break;
    }
    case "LEVERAGE_LONG": {
      // "Borrow USDC against ETH, swap to WETH"
      if (amounts.length >= 1) {
        extracted.amount = extracted.amount ?? amounts[0].amount;
        extracted.collateralToken = extracted.collateralToken ?? amounts[0].token;
      }
      const borrowMatch = lower.match(/borrow\s+(\w+)/);
      if (borrowMatch) extracted.borrowToken = extracted.borrowToken ?? borrowMatch[1].toUpperCase();
      const swapToMatch = lower.match(/swap\s+(?:to|half\s+to)\s+(\w+)/);
      if (swapToMatch) extracted.targetToken = extracted.targetToken ?? swapToMatch[1].toUpperCase();
      break;
    }
    case "YIELD_FARM": {
      // "Provide ETH/USDC liquidity on Aerodrome"
      const pairMatch = lower.match(/(\w+)\/(\w+)/);
      if (pairMatch) {
        extracted.tokenA = extracted.tokenA ?? pairMatch[1].toUpperCase();
        extracted.tokenB = extracted.tokenB ?? pairMatch[2].toUpperCase();
      }
      if (amounts.length >= 1) {
        extracted.amount = extracted.amount ?? amounts[0].amount;
      }
      break;
    }
    case "DELEVERAGE": {
      if (amounts.length >= 1) {
        extracted.repayAmount = extracted.repayAmount ?? amounts[0].amount;
        extracted.repayToken = extracted.repayToken ?? amounts[0].token;
      }
      const withdrawMatch = lower.match(/withdraw\s+(\w+)/);
      if (withdrawMatch) extracted.withdrawToken = extracted.withdrawToken ?? withdrawMatch[1].toUpperCase();
      break;
    }
    case "SUPPLY": {
      if (amounts.length >= 1) {
        extracted.amount = extracted.amount ?? amounts[0].amount;
        extracted.token = extracted.token ?? amounts[0].token;
      }
      break;
    }
    case "BORROW": {
      if (amounts.length >= 1) {
        extracted.amount = extracted.amount ?? amounts[0].amount;
        extracted.token = extracted.token ?? amounts[0].token;
      }
      break;
    }
  }

  return { type, params: extracted };
}

/**
 * Parse a natural language strategy description into one or more structured intents.
 * Handles multi-step strategies connected by "then", "and then", "after that", etc.
 * Returns null if the input cannot be parsed at all.
 */
function parseStrategyInput(
  strategyText: string,
  params: Record<string, unknown>,
): ParsedIntent[] | null {
  // Split on multi-step connectors
  const segments = strategyText.split(MULTI_STEP_CONNECTORS).map(s => s.trim()).filter(Boolean);

  if (segments.length === 0) return null;

  const intents: ParsedIntent[] = [];

  for (const segment of segments) {
    // Only pass explicit params to the first segment (they usually refer to the first action)
    const segmentParams = intents.length === 0 ? params : {};
    const intent = parseSingleIntent(segment, segmentParams);
    if (intent) {
      intents.push(intent);
    } else if (intents.length === 0) {
      // If the first segment doesn't parse, the whole thing fails
      return null;
    }
    // If a later segment doesn't parse, we skip it with a warning but keep earlier ones
  }

  return intents.length > 0 ? intents : null;
}

// ── Strategy Builders ────────────────────────────────────────────────────────

async function buildSwapPlan(
  params: Record<string, string>,
  chain: ChainConfig,
): Promise<{ steps: StrategyStep[]; outcome: Record<string, string>; risk: RiskAssessment }> {
  const tokenInInfo = resolveToken(params.tokenIn ?? "ETH", chain);
  const tokenOutInfo = resolveToken(params.tokenOut ?? "USDC", chain);
  const amount = params.amount ?? "1";

  if (!tokenInInfo || !tokenOutInfo) {
    throw new Error(`Could not resolve tokens: ${params.tokenIn} or ${params.tokenOut} on ${chain.name}`);
  }

  const amountWei = ethers.parseUnits(amount, tokenInInfo.decimals);

  // Get best quote across DEXes
  const { best, quotes } = await getBestSwapQuote(
    tokenInInfo.address,
    tokenOutInfo.address,
    amountWei,
    chain,
  );

  const steps: StrategyStep[] = [];
  let gasTotal = 0n;

  // Step 1: Approve token (if not native)
  if (params.tokenIn?.toUpperCase() !== "ETH") {
    steps.push({
      step: 1,
      protocol: best?.protocol ?? "Uniswap V3",
      action: "approve",
      description: `Approve ${best?.protocol ?? "DEX"} router to spend ${amount} ${tokenInInfo.symbol}`,
      tokenIn: tokenInInfo.symbol,
      amount,
      estimatedGas: "50000",
      requiresApproval: true,
      approvalTarget: best?.protocol === "Aerodrome"
        ? CONTRACTS.base.aerodromeRouter
        : CONTRACTS.base.uniswapRouterV2,
    });
    gasTotal += 50000n;
  }

  // Step 2: Execute swap
  const expectedOut = best
    ? ethers.formatUnits(BigInt(best.amountOut), tokenOutInfo.decimals)
    : "unknown";

  const swapGas = best?.gasEstimate ?? "200000";
  steps.push({
    step: steps.length + 1,
    protocol: best?.protocol ?? "Uniswap V3",
    action: "swap",
    description: `Swap ${amount} ${tokenInInfo.symbol} for ~${expectedOut} ${tokenOutInfo.symbol}`,
    tokenIn: tokenInInfo.symbol,
    tokenOut: tokenOutInfo.symbol,
    amount,
    estimatedGas: swapGas,
    expectedOutput: expectedOut,
  });
  gasTotal += BigInt(swapGas);

  const priceImpact = best?.priceImpact ?? 0;

  const risk: RiskAssessment = {
    overallRisk: priceImpact > 5 ? "high" : priceImpact > 1 ? "medium" : "low",
    factors: [],
    maxSlippagePct: priceImpact,
  };

  if (priceImpact > 1) {
    risk.factors.push({
      type: "slippage",
      severity: priceImpact > 5 ? "danger" : "warning",
      description: `Price impact is ${priceImpact.toFixed(2)}% — ${priceImpact > 5 ? "consider splitting into smaller swaps" : "within acceptable range"}`,
    });
  }

  if (quotes.length > 1) {
    const worstQuote = quotes[quotes.length - 1];
    const bestOut = BigInt(best!.amountOut);
    const worstOut = BigInt(worstQuote.amountOut);
    if (bestOut > 0n) {
      const savings = Number(bestOut - worstOut) / Number(bestOut) * 100;
      risk.factors.push({
        type: "routing",
        severity: "info",
        description: `Best route saves ${savings.toFixed(2)}% vs worst route (${quotes.length} routes compared)`,
      });
    }
  }

  return {
    steps,
    outcome: {
      [tokenInInfo.symbol]: `-${amount}`,
      [tokenOutInfo.symbol]: `+${expectedOut}`,
      estimatedGas: gasTotal.toString(),
    },
    risk,
  };
}

async function buildSupplyPlan(
  params: Record<string, string>,
  chain: ChainConfig,
): Promise<{ steps: StrategyStep[]; outcome: Record<string, string>; risk: RiskAssessment }> {
  const tokenInfo = resolveToken(params.token ?? "ETH", chain);
  const amount = params.amount ?? "1";

  if (!tokenInfo) {
    throw new Error(`Could not resolve token: ${params.token} on ${chain.name}`);
  }

  const steps: StrategyStep[] = [];

  // Step 1: Approve Aave Pool
  steps.push({
    step: 1,
    protocol: "Aave V3",
    action: "approve",
    description: `Approve Aave V3 Pool to spend ${amount} ${tokenInfo.symbol}`,
    tokenIn: tokenInfo.symbol,
    amount,
    estimatedGas: "50000",
    requiresApproval: true,
    approvalTarget: CONTRACTS.base.aavePool,
  });

  // Step 2: Supply to Aave
  steps.push({
    step: 2,
    protocol: "Aave V3",
    action: "supply",
    description: `Supply ${amount} ${tokenInfo.symbol} to Aave V3 to earn interest`,
    tokenIn: tokenInfo.symbol,
    amount,
    estimatedGas: "250000",
    expectedOutput: `${amount} a${tokenInfo.symbol} (interest-bearing)`,
  });

  return {
    steps,
    outcome: {
      [tokenInfo.symbol]: `-${amount}`,
      [`a${tokenInfo.symbol}`]: `+${amount}`,
      estimatedGas: "300000",
    },
    risk: {
      overallRisk: "low",
      factors: [
        {
          type: "smart_contract",
          severity: "info",
          description: "Aave V3 is battle-tested with >$10B TVL. Smart contract risk is low but non-zero.",
        },
      ],
      maxSlippagePct: 0,
    },
  };
}

async function buildBorrowPlan(
  params: Record<string, string>,
  chain: ChainConfig,
): Promise<{ steps: StrategyStep[]; outcome: Record<string, string>; risk: RiskAssessment }> {
  const tokenInfo = resolveToken(params.token ?? "USDC", chain);
  const amount = params.amount ?? "100";

  if (!tokenInfo) {
    throw new Error(`Could not resolve token: ${params.token} on ${chain.name}`);
  }

  const steps: StrategyStep[] = [];

  steps.push({
    step: 1,
    protocol: "Aave V3",
    action: "borrow",
    description: `Borrow ${amount} ${tokenInfo.symbol} from Aave V3 (variable rate)`,
    tokenOut: tokenInfo.symbol,
    amount,
    estimatedGas: "300000",
    expectedOutput: `${amount} ${tokenInfo.symbol}`,
  });

  return {
    steps,
    outcome: {
      [tokenInfo.symbol]: `+${amount}`,
      [`debt_${tokenInfo.symbol}`]: `+${amount}`,
      estimatedGas: "300000",
    },
    risk: {
      overallRisk: "medium",
      factors: [
        {
          type: "liquidation",
          severity: "warning",
          description: "Borrowing creates liquidation risk. Monitor health factor — below 1.0 triggers liquidation.",
        },
        {
          type: "interest",
          severity: "info",
          description: "Variable borrow rate fluctuates with market demand. Check current rates.",
        },
      ],
      maxSlippagePct: 0,
      liquidationRisk: "Monitor health factor. Stay above 1.5 for safety margin.",
    },
  };
}

async function buildLeverageLongPlan(
  params: Record<string, string>,
  chain: ChainConfig,
): Promise<{ steps: StrategyStep[]; outcome: Record<string, string>; risk: RiskAssessment }> {
  const collateralToken = resolveToken(params.collateralToken ?? "ETH", chain);
  const borrowToken = resolveToken(params.borrowToken ?? "USDC", chain);
  const targetToken = resolveToken(params.targetToken ?? params.collateralToken ?? "ETH", chain);
  const amount = params.amount ?? "1";

  if (!collateralToken || !borrowToken || !targetToken) {
    throw new Error("Could not resolve one or more tokens for leverage strategy");
  }

  const steps: StrategyStep[] = [];
  let gasTotal = 0n;

  // Step 1: Approve collateral to Aave
  steps.push({
    step: 1,
    protocol: "Aave V3",
    action: "approve",
    description: `Approve Aave V3 Pool to spend ${amount} ${collateralToken.symbol}`,
    tokenIn: collateralToken.symbol,
    amount,
    estimatedGas: "50000",
    requiresApproval: true,
    approvalTarget: CONTRACTS.base.aavePool,
  });
  gasTotal += 50000n;

  // Step 2: Supply collateral
  steps.push({
    step: 2,
    protocol: "Aave V3",
    action: "supply",
    description: `Supply ${amount} ${collateralToken.symbol} as collateral to Aave V3`,
    tokenIn: collateralToken.symbol,
    amount,
    estimatedGas: "250000",
  });
  gasTotal += 250000n;

  // Step 3: Borrow stablecoin (conservative 50% LTV)
  // This is a rough estimate — actual depends on oracle prices
  const borrowAmount = params.borrowAmount ?? "500"; // placeholder
  steps.push({
    step: 3,
    protocol: "Aave V3",
    action: "borrow",
    description: `Borrow ~${borrowAmount} ${borrowToken.symbol} against collateral (variable rate)`,
    tokenOut: borrowToken.symbol,
    amount: borrowAmount,
    estimatedGas: "300000",
    expectedOutput: `${borrowAmount} ${borrowToken.symbol}`,
  });
  gasTotal += 300000n;

  // Step 4: Swap borrowed tokens to target
  steps.push({
    step: 4,
    protocol: "Uniswap V3",
    action: "swap",
    description: `Swap ${borrowAmount} ${borrowToken.symbol} to ${targetToken.symbol} for leveraged exposure`,
    tokenIn: borrowToken.symbol,
    tokenOut: targetToken.symbol,
    amount: borrowAmount,
    estimatedGas: "200000",
    requiresApproval: true,
    approvalTarget: CONTRACTS.base.uniswapRouterV2,
  });
  gasTotal += 200000n;

  return {
    steps,
    outcome: {
      [`collateral_${collateralToken.symbol}`]: `+${amount}`,
      [`debt_${borrowToken.symbol}`]: `+${borrowAmount}`,
      [targetToken.symbol]: `+estimated (from swap)`,
      estimatedGas: gasTotal.toString(),
    },
    risk: {
      overallRisk: "high",
      factors: [
        {
          type: "liquidation",
          severity: "danger",
          description: `Leveraged position can be liquidated if ${collateralToken.symbol} price drops. Monitor health factor continuously.`,
        },
        {
          type: "interest",
          severity: "warning",
          description: `Borrow interest accrues on ${borrowToken.symbol} debt. Ensure yield exceeds borrow cost.`,
        },
        {
          type: "slippage",
          severity: "warning",
          description: "Swap step may incur slippage. Use slippage protection.",
        },
      ],
      maxSlippagePct: 2,
      liquidationRisk: "HIGH — leveraged positions amplify liquidation risk. Keep health factor above 2.0.",
    },
  };
}

async function buildYieldFarmPlan(
  params: Record<string, string>,
  chain: ChainConfig,
): Promise<{ steps: StrategyStep[]; outcome: Record<string, string>; risk: RiskAssessment }> {
  const tokenA = resolveToken(params.tokenA ?? "ETH", chain);
  const tokenB = resolveToken(params.tokenB ?? "USDC", chain);
  const amount = params.amount ?? "1";

  if (!tokenA || !tokenB) {
    throw new Error(`Could not resolve tokens: ${params.tokenA} or ${params.tokenB} on ${chain.name}`);
  }

  const steps: StrategyStep[] = [];
  let gasTotal = 0n;

  // Step 1: Approve token A
  steps.push({
    step: 1,
    protocol: "Aerodrome",
    action: "approve",
    description: `Approve Aerodrome Router to spend ${tokenA.symbol}`,
    tokenIn: tokenA.symbol,
    estimatedGas: "50000",
    requiresApproval: true,
    approvalTarget: CONTRACTS.base.aerodromeRouter,
  });
  gasTotal += 50000n;

  // Step 2: Approve token B
  steps.push({
    step: 2,
    protocol: "Aerodrome",
    action: "approve",
    description: `Approve Aerodrome Router to spend ${tokenB.symbol}`,
    tokenIn: tokenB.symbol,
    estimatedGas: "50000",
    requiresApproval: true,
    approvalTarget: CONTRACTS.base.aerodromeRouter,
  });
  gasTotal += 50000n;

  // Step 3: Add liquidity
  steps.push({
    step: 3,
    protocol: "Aerodrome",
    action: "addLiquidity",
    description: `Provide ${tokenA.symbol}/${tokenB.symbol} liquidity on Aerodrome`,
    tokenIn: `${tokenA.symbol} + ${tokenB.symbol}`,
    amount,
    estimatedGas: "350000",
    expectedOutput: `LP tokens for ${tokenA.symbol}/${tokenB.symbol}`,
  });
  gasTotal += 350000n;

  return {
    steps,
    outcome: {
      [tokenA.symbol]: `-${amount} (half)`,
      [tokenB.symbol]: `-equivalent`,
      LP_tokens: `+${tokenA.symbol}/${tokenB.symbol} LP`,
      estimatedGas: gasTotal.toString(),
    },
    risk: {
      overallRisk: "medium",
      factors: [
        {
          type: "impermanent_loss",
          severity: "warning",
          description: `Providing liquidity exposes you to impermanent loss if ${tokenA.symbol}/${tokenB.symbol} price ratio changes significantly.`,
        },
        {
          type: "smart_contract",
          severity: "info",
          description: "Aerodrome is the largest DEX on Base by TVL. Smart contract risk is low.",
        },
      ],
      maxSlippagePct: 1,
      impermanentLossRisk: `Medium — volatile pairs like ${tokenA.symbol}/${tokenB.symbol} can experience significant IL during price swings.`,
    },
  };
}

async function buildDeleveragePlan(
  params: Record<string, string>,
  chain: ChainConfig,
): Promise<{ steps: StrategyStep[]; outcome: Record<string, string>; risk: RiskAssessment }> {
  const repayToken = resolveToken(params.repayToken ?? "USDC", chain);
  const withdrawToken = resolveToken(params.withdrawToken ?? "ETH", chain);
  const repayAmount = params.repayAmount ?? "all";

  if (!repayToken || !withdrawToken) {
    throw new Error("Could not resolve tokens for deleverage strategy");
  }

  const steps: StrategyStep[] = [];
  let gasTotal = 0n;

  // Step 1: Approve repayment
  steps.push({
    step: 1,
    protocol: "Aave V3",
    action: "approve",
    description: `Approve Aave V3 Pool to spend ${repayAmount} ${repayToken.symbol} for repayment`,
    tokenIn: repayToken.symbol,
    amount: repayAmount,
    estimatedGas: "50000",
    requiresApproval: true,
    approvalTarget: CONTRACTS.base.aavePool,
  });
  gasTotal += 50000n;

  // Step 2: Repay debt
  steps.push({
    step: 2,
    protocol: "Aave V3",
    action: "repay",
    description: `Repay ${repayAmount} ${repayToken.symbol} debt on Aave V3`,
    tokenIn: repayToken.symbol,
    amount: repayAmount,
    estimatedGas: "250000",
  });
  gasTotal += 250000n;

  // Step 3: Withdraw collateral
  steps.push({
    step: 3,
    protocol: "Aave V3",
    action: "withdraw",
    description: `Withdraw ${withdrawToken.symbol} collateral from Aave V3`,
    tokenOut: withdrawToken.symbol,
    estimatedGas: "250000",
    expectedOutput: `${withdrawToken.symbol} collateral returned`,
  });
  gasTotal += 250000n;

  return {
    steps,
    outcome: {
      [repayToken.symbol]: `-${repayAmount}`,
      [`debt_${repayToken.symbol}`]: `-${repayAmount}`,
      [withdrawToken.symbol]: `+collateral returned`,
      estimatedGas: gasTotal.toString(),
    },
    risk: {
      overallRisk: "low",
      factors: [
        {
          type: "execution",
          severity: "info",
          description: "Deleveraging reduces risk. Ensure you have enough tokens to repay the full debt.",
        },
      ],
      maxSlippagePct: 0,
    },
  };
}

// ── Main Simulation Entry Point ──────────────────────────────────────────────

/**
 * Build plan data for a single intent.
 */
async function buildPlanForIntent(
  intent: ParsedIntent,
  chain: ChainConfig,
): Promise<{ steps: StrategyStep[]; outcome: Record<string, string>; risk: RiskAssessment }> {
  switch (intent.type) {
    case "SWAP":
      return buildSwapPlan(intent.params, chain);
    case "SUPPLY":
      return buildSupplyPlan(intent.params, chain);
    case "BORROW":
      return buildBorrowPlan(intent.params, chain);
    case "LEVERAGE_LONG":
      return buildLeverageLongPlan(intent.params, chain);
    case "YIELD_FARM":
      return buildYieldFarmPlan(intent.params, chain);
    case "DELEVERAGE":
      return buildDeleveragePlan(intent.params, chain);
    default:
      throw new Error(`Strategy type ${intent.type} is not yet implemented.`);
  }
}

/**
 * Simulate a DeFi strategy from natural language + optional params.
 * Returns a full execution plan that can be passed to the executor.
 * Supports multi-step strategies like "supply 1 ETH then borrow 100 USDC".
 */
export async function simulateStrategy(
  strategyText: string,
  params: Record<string, unknown>,
  chainName?: string,
): Promise<StrategyPlan> {
  const chain = resolveChain(chainName);

  // Check for unsupported protocol references before parsing
  const unsupportedProtocol = checkForUnsupportedProtocol(strategyText);
  if (unsupportedProtocol) {
    throw new Error(
      `Unsupported protocol: "${unsupportedProtocol}". ` +
      `Supported protocols on Base: Uniswap V3, Aave V3, Aerodrome. ` +
      `Please rephrase using a supported protocol.`,
    );
  }

  const intents = parseStrategyInput(strategyText, params);

  if (!intents || intents.length === 0) {
    throw new Error(
      `Could not understand strategy: "${strategyText}". ` +
      `Try phrases like "swap 1 ETH to USDC", "provide ETH/USDC liquidity", ` +
      `"supply 1 ETH to Aave", or "borrow 100 USDC". ` +
      `Multi-step strategies are supported: "supply 1 ETH then borrow 100 USDC".`,
    );
  }

  // Build plans for all intents
  const allSteps: StrategyStep[] = [];
  const mergedOutcome: Record<string, string> = {};
  const allRiskFactors: RiskAssessment["factors"] = [];
  let worstRisk: RiskAssessment["overallRisk"] = "low";
  let maxSlippage = 0;
  let totalGas = 0n;
  let liquidationRisk: string | undefined;
  let impermanentLossRisk: string | undefined;

  const riskOrder: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };

  for (const intent of intents) {
    const planData = await buildPlanForIntent(intent, chain);

    // Re-number steps to be sequential across all intents
    const stepOffset = allSteps.length;
    for (const step of planData.steps) {
      allSteps.push({ ...step, step: stepOffset + step.step });
    }

    // Merge outcomes
    for (const [k, v] of Object.entries(planData.outcome)) {
      if (k === "estimatedGas") {
        totalGas += BigInt(v);
      } else {
        mergedOutcome[k] = v;
      }
    }

    // Merge risk assessment (take the worst)
    allRiskFactors.push(...planData.risk.factors);
    if (riskOrder[planData.risk.overallRisk] > riskOrder[worstRisk]) {
      worstRisk = planData.risk.overallRisk;
    }
    if (planData.risk.maxSlippagePct > maxSlippage) {
      maxSlippage = planData.risk.maxSlippagePct;
    }
    if (planData.risk.liquidationRisk) liquidationRisk = planData.risk.liquidationRisk;
    if (planData.risk.impermanentLossRisk) impermanentLossRisk = planData.risk.impermanentLossRisk;
  }

  mergedOutcome.estimatedGas = totalGas.toString();

  // Use the first intent's type as the primary type, append info about multi-step
  const primaryType = intents[0].type;
  const template = STRATEGY_TEMPLATES[primaryType];
  const isMultiStep = intents.length > 1;
  const summaryPrefix = isMultiStep
    ? `Multi-step (${intents.map(i => i.type).join(" → ")})`
    : template.name;

  const plan: StrategyPlan = {
    strategyId: generateStrategyId(),
    type: primaryType,
    summary: `${summaryPrefix}: ${strategyText}`,
    steps: allSteps,
    totalGasEstimate: mergedOutcome.estimatedGas ?? "0",
    risk: {
      overallRisk: worstRisk,
      factors: allRiskFactors,
      maxSlippagePct: maxSlippage,
      liquidationRisk,
      impermanentLossRisk,
    },
    simulatedOutcome: mergedOutcome,
    chain: chain.name,
    simulatedAt: new Date().toISOString(),
  };

  // Cache for later execution (TTL: 1 hour, max 1000 entries)
  cacheStrategy(plan);

  return plan;
}
