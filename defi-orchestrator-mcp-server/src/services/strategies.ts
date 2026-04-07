/**
 * Pre-built strategy templates for common DeFi operations.
 *
 * Each template defines the steps, required parameters, and risk profile
 * for a compound DeFi strategy.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type StrategyType = "SWAP" | "LEVERAGE_LONG" | "YIELD_FARM" | "DELEVERAGE" | "SUPPLY" | "BORROW";

export interface StrategyStep {
  /** Step number (1-indexed) */
  step: number;
  /** Protocol used for this step */
  protocol: string;
  /** Action: swap, supply, borrow, withdraw, repay, addLiquidity, stake */
  action: string;
  /** Human-readable description */
  description: string;
  /** Token being sent */
  tokenIn?: string;
  /** Token being received */
  tokenOut?: string;
  /** Amount in human-readable form */
  amount?: string;
  /** Estimated gas for this step */
  estimatedGas: string;
  /** Expected output amount (from simulation) */
  expectedOutput?: string;
  /** Needs token approval first? */
  requiresApproval?: boolean;
  /** Approval target contract */
  approvalTarget?: string;
}

export interface RiskAssessment {
  /** Overall risk level */
  overallRisk: "low" | "medium" | "high" | "critical";
  /** Individual risk factors */
  factors: Array<{
    type: string;
    severity: "info" | "warning" | "danger";
    description: string;
  }>;
  /** Max slippage expected across all steps */
  maxSlippagePct: number;
  /** Impermanent loss risk (for LP strategies) */
  impermanentLossRisk?: string;
  /** Liquidation risk (for lending strategies) */
  liquidationRisk?: string;
}

export interface StrategyPlan {
  /** Unique ID for this simulation (used to execute later) */
  strategyId: string;
  /** Strategy type */
  type: StrategyType;
  /** Human-readable summary */
  summary: string;
  /** Ordered steps to execute */
  steps: StrategyStep[];
  /** Total estimated gas */
  totalGasEstimate: string;
  /** Risk assessment */
  risk: RiskAssessment;
  /** Simulated final balances */
  simulatedOutcome: Record<string, string>;
  /** Chain this was simulated on */
  chain: string;
  /** Timestamp of simulation */
  simulatedAt: string;
}

// ── Strategy Templates ───────────────────────────────────────────────────────

export interface StrategyTemplate {
  type: StrategyType;
  name: string;
  description: string;
  /** Keywords that trigger this template from natural language */
  keywords: string[];
  /** Required parameters */
  requiredParams: string[];
  /** Default risk profile */
  baseRisk: RiskAssessment["overallRisk"];
}

export const STRATEGY_TEMPLATES: Record<StrategyType, StrategyTemplate> = {
  SWAP: {
    type: "SWAP",
    name: "Simple Token Swap",
    description: "Swap one token for another using the best available DEX route",
    keywords: ["swap", "exchange", "trade", "convert", "buy", "sell"],
    requiredParams: ["tokenIn", "tokenOut", "amount"],
    baseRisk: "low",
  },
  LEVERAGE_LONG: {
    type: "LEVERAGE_LONG",
    name: "Leveraged Long",
    description: "Supply collateral to Aave, borrow stablecoin, swap to target asset for leveraged exposure",
    keywords: ["leverage", "long", "leveraged long", "margin", "borrow and buy"],
    requiredParams: ["collateralToken", "borrowToken", "targetToken", "amount"],
    baseRisk: "high",
  },
  YIELD_FARM: {
    type: "YIELD_FARM",
    name: "Yield Farm",
    description: "Provide liquidity to a DEX pool to earn trading fees and reward tokens",
    keywords: ["yield", "farm", "liquidity", "provide liquidity", "LP", "pool"],
    requiredParams: ["tokenA", "tokenB", "amount"],
    baseRisk: "medium",
  },
  DELEVERAGE: {
    type: "DELEVERAGE",
    name: "Deleverage Position",
    description: "Repay borrowed debt and withdraw collateral from Aave",
    keywords: ["deleverage", "repay", "unwind", "close position", "withdraw collateral"],
    requiredParams: ["repayToken", "repayAmount", "withdrawToken"],
    baseRisk: "low",
  },
  SUPPLY: {
    type: "SUPPLY",
    name: "Supply to Lending",
    description: "Supply tokens to Aave V3 to earn interest",
    keywords: ["supply", "lend", "deposit to aave", "earn interest"],
    requiredParams: ["token", "amount"],
    baseRisk: "low",
  },
  BORROW: {
    type: "BORROW",
    name: "Borrow from Lending",
    description: "Borrow tokens from Aave V3 against existing collateral",
    keywords: ["borrow", "take loan", "borrow against"],
    requiredParams: ["token", "amount"],
    baseRisk: "medium",
  },
};

/**
 * Match a natural language strategy description to a template.
 */
export function matchStrategy(input: string): StrategyType | null {
  const lower = input.toLowerCase();

  // Score each template by keyword matches
  let bestMatch: StrategyType | null = null;
  let bestScore = 0;

  for (const [type, template] of Object.entries(STRATEGY_TEMPLATES)) {
    let score = 0;
    for (const keyword of template.keywords) {
      if (lower.includes(keyword)) {
        score += keyword.length; // longer matches are more specific
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = type as StrategyType;
    }
  }

  return bestMatch;
}

// ── Strategy ID Generation ───────────────────────────────────────────────────

let _counter = 0;

export function generateStrategyId(): string {
  _counter++;
  const ts = Date.now().toString(36);
  const cnt = _counter.toString(36).padStart(4, "0");
  return `strat_${ts}_${cnt}`;
}
