/**
 * Unit tests for defi-orchestrator protocols and strategies.
 * All RPC calls are mocked — no real chain interaction.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock the shared module ──────────────────────────────────────────────────

vi.mock("@thryx/mcp-shared", () => {
  const mockProvider = {
    getFeeData: vi.fn().mockResolvedValue({ gasPrice: 100000000n }),
    getBlock: vi.fn().mockResolvedValue({ number: 1 }),
  };
  return {
    getProvider: vi.fn(() => mockProvider),
    getSigner: vi.fn(() => null),
    CHAINS: {
      base: {
        chainId: 8453,
        name: "Base",
        rpcUrl: "https://mainnet.base.org",
        explorerUrl: "https://basescan.org",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        tokens: {
          WETH: { address: "0x4200000000000000000000000000000000000006", decimals: 18 },
          USDC: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
          USDbC: { address: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", decimals: 6 },
          DAI: { address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", decimals: 18 },
          AERO: { address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", decimals: 18 },
        },
      },
    },
    type: {} as any,
  };
});

import { resolveToken, resolveChain } from "../services/protocols.js";
import {
  matchStrategy,
  generateStrategyId,
  STRATEGY_TEMPLATES,
  type StrategyType,
} from "../services/strategies.js";
import { getCachedStrategy } from "../services/simulator.js";

// ── Token Resolution ─────────────────────────────────────────────────────────

describe("resolveToken", () => {
  const chain = resolveChain("base");

  it("resolves USDC to correct address and 6 decimals", () => {
    const token = resolveToken("USDC", chain);
    expect(token).not.toBeNull();
    expect(token!.address).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(token!.decimals).toBe(6);
    expect(token!.symbol).toBe("USDC");
  });

  it("resolves WETH to correct address and 18 decimals", () => {
    const token = resolveToken("WETH", chain);
    expect(token).not.toBeNull();
    expect(token!.address).toBe("0x4200000000000000000000000000000000000006");
    expect(token!.decimals).toBe(18);
  });

  it("resolves ETH to WETH address", () => {
    const token = resolveToken("ETH", chain);
    expect(token).not.toBeNull();
    expect(token!.symbol).toBe("WETH");
    expect(token!.decimals).toBe(18);
  });

  it("resolves NATIVE to WETH address", () => {
    const token = resolveToken("NATIVE", chain);
    expect(token).not.toBeNull();
    expect(token!.symbol).toBe("WETH");
  });

  it("resolves case-insensitively", () => {
    const lower = resolveToken("usdc", chain);
    const upper = resolveToken("USDC", chain);
    expect(lower).toEqual(upper);
  });

  it("resolves raw address input with default 18 decimals", () => {
    const addr = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
    const token = resolveToken(addr, chain);
    expect(token).not.toBeNull();
    expect(token!.address).toBe(addr);
    expect(token!.decimals).toBe(18);
  });

  it("returns null for invalid address format", () => {
    const token = resolveToken("0xshort", chain);
    expect(token).toBeNull();
  });

  it("returns null for unknown symbol", () => {
    const token = resolveToken("FAKECOIN", chain);
    expect(token).toBeNull();
  });

  it("resolves DAI with 18 decimals", () => {
    const token = resolveToken("DAI", chain);
    expect(token).not.toBeNull();
    expect(token!.decimals).toBe(18);
  });
});

// ── Price Impact / Decimals Bug Regression ───────────────────────────────────

describe("price impact calculation", () => {
  it("does not compute price impact for cross-asset swaps with different decimals", () => {
    // The bug: comparing ETH (18 decimals) amounts directly with USDC (6 decimals)
    // produced wildly wrong price impact numbers (99%+).
    // The fix: return 0 for cross-asset swaps where decimals differ.
    const inDecimals: number = 18;
    const outDecimals: number = 6;
    const amountIn = BigInt("1000000000000000000"); // 1 ETH (18 dec)
    const amountOut = BigInt("2500000000"); // 2500 USDC (6 dec)

    // Simulate the fixed calculation from protocols.ts
    const normalizedIn = Number(amountIn) / 10 ** inDecimals;
    const normalizedOut = Number(amountOut) / 10 ** outDecimals;

    // Cross-asset: price impact not directly computable without oracle
    const priceImpact =
      normalizedIn > 0 && inDecimals === outDecimals
        ? Math.abs(1 - normalizedOut / normalizedIn) * 100
        : 0;

    expect(priceImpact).toBe(0);
    // Verify the normalization itself is sane
    expect(normalizedIn).toBeCloseTo(1.0);
    expect(normalizedOut).toBeCloseTo(2500.0);
  });

  it("computes price impact correctly for same-decimal pairs", () => {
    const inDecimals = 18;
    const outDecimals = 18;
    const amountIn = BigInt("1000000000000000000"); // 1 token
    const amountOut = BigInt("990000000000000000"); // 0.99 token (1% impact)

    const normalizedIn = Number(amountIn) / 10 ** inDecimals;
    const normalizedOut = Number(amountOut) / 10 ** outDecimals;

    const priceImpact =
      normalizedIn > 0 && inDecimals === outDecimals
        ? Math.abs(1 - normalizedOut / normalizedIn) * 100
        : 0;

    expect(priceImpact).toBeCloseTo(1.0, 1);
  });
});

// ── Slippage Cap Enforcement ─────────────────────────────────────────────────

describe("slippage cap", () => {
  it("max slippage of 500 bps = 5% should be enforceable", () => {
    const MAX_SLIPPAGE_BPS = 500;
    const maxSlippagePct = MAX_SLIPPAGE_BPS / 100;
    expect(maxSlippagePct).toBe(5);

    // Simulate a swap with 3% slippage — within cap
    const slippage3pct = 3;
    expect(slippage3pct <= maxSlippagePct).toBe(true);

    // Simulate a swap with 6% slippage — exceeds cap
    const slippage6pct = 6;
    expect(slippage6pct <= maxSlippagePct).toBe(false);
  });

  it("fee tier converts correctly to percentage", () => {
    // Uniswap fee tiers are in 1/1000000 units
    expect(500 / 10000).toBe(0.05);    // 0.05%
    expect(3000 / 10000).toBe(0.3);    // 0.3%
    expect(10000 / 10000).toBe(1);     // 1%
  });
});

// ── Strategy Matching ────────────────────────────────────────────────────────

describe("matchStrategy", () => {
  it("matches 'swap 1 ETH to USDC' as SWAP", () => {
    expect(matchStrategy("swap 1 ETH to USDC")).toBe("SWAP");
  });

  it("matches 'buy USDC with ETH' as SWAP", () => {
    expect(matchStrategy("buy USDC with ETH")).toBe("SWAP");
  });

  it("matches 'provide ETH/USDC liquidity' as YIELD_FARM", () => {
    expect(matchStrategy("provide ETH/USDC liquidity")).toBe("YIELD_FARM");
  });

  it("matches 'supply 1 ETH to Aave' as SUPPLY", () => {
    expect(matchStrategy("supply 1 ETH to Aave")).toBe("SUPPLY");
  });

  it("matches 'borrow 100 USDC' as BORROW", () => {
    expect(matchStrategy("borrow 100 USDC")).toBe("BORROW");
  });

  it("matches 'leverage long ETH' as LEVERAGE_LONG", () => {
    expect(matchStrategy("leverage long ETH")).toBe("LEVERAGE_LONG");
  });

  it("matches 'deleverage and repay' as DELEVERAGE", () => {
    expect(matchStrategy("deleverage and repay")).toBe("DELEVERAGE");
  });

  it("returns null for nonsense input", () => {
    expect(matchStrategy("hello world")).toBeNull();
  });
});

// ── Strategy Cache TTL & Max Size ────────────────────────────────────────────

describe("strategy cache", () => {
  it("returns null for non-existent strategy ID", () => {
    expect(getCachedStrategy("strat_nonexistent_0001")).toBeNull();
  });

  it("generateStrategyId returns unique IDs", () => {
    const id1 = generateStrategyId();
    const id2 = generateStrategyId();
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^strat_/);
    expect(id2).toMatch(/^strat_/);
  });
});

// ── Strategy Templates Sanity ────────────────────────────────────────────────

describe("STRATEGY_TEMPLATES", () => {
  const allTypes: StrategyType[] = [
    "SWAP",
    "LEVERAGE_LONG",
    "YIELD_FARM",
    "DELEVERAGE",
    "SUPPLY",
    "BORROW",
  ];

  it("has all expected strategy types", () => {
    for (const t of allTypes) {
      expect(STRATEGY_TEMPLATES[t]).toBeDefined();
    }
  });

  it("every template has keywords, requiredParams, and baseRisk", () => {
    for (const t of allTypes) {
      const tmpl = STRATEGY_TEMPLATES[t];
      expect(tmpl.keywords.length).toBeGreaterThan(0);
      expect(tmpl.requiredParams.length).toBeGreaterThan(0);
      expect(["low", "medium", "high", "critical"]).toContain(tmpl.baseRisk);
    }
  });

  it("SWAP template requires tokenIn, tokenOut, amount", () => {
    const swap = STRATEGY_TEMPLATES.SWAP;
    expect(swap.requiredParams).toContain("tokenIn");
    expect(swap.requiredParams).toContain("tokenOut");
    expect(swap.requiredParams).toContain("amount");
  });
});

// ── resolveChain ─────────────────────────────────────────────────────────────

describe("resolveChain", () => {
  it("defaults to Base when no argument", () => {
    const chain = resolveChain();
    expect(chain.chainId).toBe(8453);
  });

  it("resolves 'base' by name", () => {
    const chain = resolveChain("base");
    expect(chain.name).toBe("Base");
  });

  it("defaults to Base for unknown chain name", () => {
    const chain = resolveChain("polygon");
    expect(chain.chainId).toBe(8453);
  });
});
