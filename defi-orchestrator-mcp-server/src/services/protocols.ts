/**
 * Protocol integrations — ABI fragments and contract addresses for
 * Uniswap V3, Aave V3, and Aerodrome on Base mainnet.
 *
 * Each protocol exposes typed read helpers that use the shared provider.
 */

import { ethers } from "ethers";
import { getProvider, CHAINS, type ChainConfig } from "@thryx/mcp-shared";

// ── Contract Addresses (Base mainnet) ────────────────────────────────────────

export const CONTRACTS = {
  base: {
    // Uniswap V3
    uniswapQuoterV2: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
    uniswapRouterV2: "0x2626664c2603336E57B271c5C0b26F421741e481",
    uniswapFactory: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
    // Aave V3
    aavePool: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
    aavePoolDataProvider: "0x2d8A3C5677189723C4cB8873CfC9C8976FDF38Ac",
    aaveOracle: "0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156",
    // Aerodrome
    aerodromeRouter: "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43",
    aerodromeFactory: "0x420DD381b31aEf6683db6B902084cB0FFECe40Da",
    // Multicall3
    multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
  },
} as const;

// ── ABI Fragments ────────────────────────────────────────────────────────────

export const UNISWAP_QUOTER_ABI = [
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
];

export const UNISWAP_ROUTER_ABI = [
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)",
];

export const AAVE_POOL_ABI = [
  "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external",
  "function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf) external",
  "function repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) external returns (uint256)",
  "function withdraw(address asset, uint256 amount, address to) external returns (uint256)",
  "function getUserAccountData(address user) external view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)",
];

export const AAVE_DATA_PROVIDER_ABI = [
  "function getUserReserveData(address asset, address user) external view returns (uint256 currentATokenBalance, uint256 currentStableDebt, uint256 currentVariableDebt, uint256 principalStableDebt, uint256 scaledVariableDebt, uint256 stableBorrowRate, uint256 liquidityRate, uint40 stableRateLastUpdated, bool usageAsCollateralEnabled)",
  "function getReserveData(address asset) external view returns (uint256 unbacked, uint256 accruedToTreasuryScaled, uint256 totalAToken, uint256 totalStableDebt, uint256 totalVariableDebt, uint256 liquidityRate, uint256 variableBorrowRate, uint256 stableBorrowRate, uint256 averageStableBorrowRate, uint256 liquidityIndex, uint256 variableBorrowIndex, uint40 lastUpdateTimestamp)",
  "function getAllReservesTokens() external view returns ((string symbol, address tokenAddress)[])",
];

export const AAVE_ORACLE_ABI = [
  "function getAssetPrice(address asset) external view returns (uint256)",
  "function getAssetsPrices(address[] calldata assets) external view returns (uint256[])",
];

export const AERODROME_ROUTER_ABI = [
  "function getAmountOut(uint256 amountIn, address tokenIn, address tokenOut) external view returns (uint256 amount, bool stable)",
  "function addLiquidity(address tokenA, address tokenB, bool stable, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) external returns (uint256 amountA, uint256 amountB, uint256 liquidity)",
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, (address from, address to, bool stable, address factory)[] calldata routes, address to, uint256 deadline) external returns (uint256[] amounts)",
];

export const MULTICALL3_ABI = [
  "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) external payable returns ((bool success, bytes returnData)[])",
];

export const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
  "function allowance(address, address) view returns (uint256)",
];

// ── Protocol Interfaces ──────────────────────────────────────────────────────

export interface SwapQuote {
  protocol: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  priceImpact: number;
  fee: number;
  gasEstimate: string;
  route: string;
}

export interface LendingPosition {
  protocol: string;
  asset: string;
  assetAddress: string;
  supplied: string;
  borrowed: string;
  supplyAPY: number;
  borrowAPY: number;
  collateralEnabled: boolean;
}

export interface AccountHealth {
  totalCollateralUsd: string;
  totalDebtUsd: string;
  availableBorrowsUsd: string;
  liquidationThreshold: string;
  ltv: string;
  healthFactor: string;
}

export interface LpPosition {
  protocol: string;
  pool: string;
  tokenA: string;
  tokenB: string;
  amountA: string;
  amountB: string;
  valueUsd: string;
  lpTokens: string;
}

export interface YieldPool {
  protocol: string;
  pool: string;
  tokenA: string;
  tokenB: string;
  apy: number;
  apyBase: number;
  apyReward: number;
  tvl: string;
  stable: boolean;
  riskRating: "low" | "medium" | "high";
}

// ── Resolve chain helper ─────────────────────────────────────────────────────

export function resolveChain(chain?: string): ChainConfig {
  if (!chain) return CHAINS.base;
  const c = CHAINS[chain.toLowerCase()];
  if (!c) return CHAINS.base;
  return c;
}

// ── Token resolution ─────────────────────────────────────────────────────────

/**
 * Resolve a token symbol or address to a canonical address + decimals on the given chain.
 * Returns null if not found in well-known list and input is not an address.
 */
export function resolveToken(
  tokenInput: string,
  chain: ChainConfig,
): { address: string; decimals: number; symbol: string } | null {
  // If it's already an address, validate and return with defaults
  if (tokenInput.startsWith("0x")) {
    if (tokenInput.length !== 42 || !/^0x[0-9a-fA-F]{40}$/.test(tokenInput)) {
      return null; // Invalid address format
    }
    return { address: tokenInput, decimals: 18, symbol: tokenInput.slice(0, 8) };
  }

  // Handle ETH/native
  const upper = tokenInput.toUpperCase();
  if (upper === "ETH" || upper === "NATIVE") {
    const weth = chain.tokens["WETH"];
    if (weth) return { address: weth.address, decimals: weth.decimals, symbol: "WETH" };
    return null;
  }

  // Look up in chain's well-known tokens
  const token = chain.tokens[upper];
  if (token) return { address: token.address, decimals: token.decimals, symbol: upper };

  return null;
}

// ── Uniswap V3 Helpers ──────────────────────────────────────────────────────

/**
 * Get a swap quote from Uniswap V3 Quoter on Base.
 */
export async function getUniswapQuote(
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  chain: ChainConfig,
  feeTier: number = 3000,
): Promise<SwapQuote | null> {
  try {
    const provider = getProvider(chain);
    const addrs = chain.chainId === 8453 ? CONTRACTS.base : null;
    if (!addrs) return null;

    const quoter = new ethers.Contract(addrs.uniswapQuoterV2, UNISWAP_QUOTER_ABI, provider as any);

    const params = {
      tokenIn,
      tokenOut,
      amountIn,
      fee: feeTier,
      sqrtPriceLimitX96: 0n,
    };

    const result = await quoter.quoteExactInputSingle.staticCall(params);

    if (!result || result.length < 4) {
      throw new Error("Invalid quote response from Uniswap V3 Quoter");
    }
    const amountOut = result[0] as bigint;
    if (amountOut <= 0n) throw new Error("Quote returned zero output — insufficient liquidity");
    const gasEstimate = result[3] as bigint;

    // Price impact: normalize both amounts to same decimal scale before comparing.
    // amountIn may be 18 decimals (ETH/WETH), amountOut may be 6 decimals (USDC).
    // We convert both to float for comparison. This is a rough estimate, not exact.
    const inDecimals = 18; // tokenIn decimals (TODO: look up dynamically)
    const outDecimals = tokenOut.toLowerCase() === "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" ? 6 : 18;
    const normalizedIn = Number(amountIn) / (10 ** inDecimals);
    const normalizedOut = Number(amountOut) / (10 ** outDecimals);
    // Price impact only makes sense for same-asset comparisons; for cross-asset swaps
    // we report the effective rate instead
    const priceImpact = normalizedIn > 0 && inDecimals === outDecimals
      ? Math.abs(1 - normalizedOut / normalizedIn) * 100
      : 0; // Cross-asset: price impact not directly computable without oracle

    return {
      protocol: "Uniswap V3",
      tokenIn,
      tokenOut,
      amountIn: amountIn.toString(),
      amountOut: amountOut.toString(),
      priceImpact,
      fee: feeTier / 10000,
      gasEstimate: gasEstimate.toString(),
      route: `${tokenIn} → ${tokenOut} (fee: ${feeTier / 10000}%)`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[protocols] Uniswap quote failed: ${msg}\n`);
    return null;
  }
}

/**
 * Get a swap quote from Aerodrome on Base.
 */
export async function getAerodromeQuote(
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  chain: ChainConfig,
): Promise<SwapQuote | null> {
  try {
    const provider = getProvider(chain);
    const addrs = chain.chainId === 8453 ? CONTRACTS.base : null;
    if (!addrs) return null;

    const router = new ethers.Contract(addrs.aerodromeRouter, AERODROME_ROUTER_ABI, provider as any);
    const [amountOut, stable] = await router.getAmountOut(amountIn, tokenIn, tokenOut);

    // Same decimal normalization as Uniswap (cross-asset = 0 impact)
    const priceImpact = 0; // Cross-asset swaps: price impact requires oracle, report 0

    return {
      protocol: "Aerodrome",
      tokenIn,
      tokenOut,
      amountIn: amountIn.toString(),
      amountOut: (amountOut as bigint).toString(),
      priceImpact,
      fee: stable ? 0.01 : 0.3,
      gasEstimate: "150000",
      route: `${tokenIn} → ${tokenOut} (${stable ? "stable" : "volatile"})`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[protocols] Aerodrome quote failed: ${msg}\n`);
    return null;
  }
}

/**
 * Get Aave V3 account health data for a wallet.
 */
export async function getAaveAccountHealth(
  wallet: string,
  chain: ChainConfig,
): Promise<AccountHealth | null> {
  try {
    const provider = getProvider(chain);
    const addrs = chain.chainId === 8453 ? CONTRACTS.base : null;
    if (!addrs) return null;

    const pool = new ethers.Contract(addrs.aavePool, AAVE_POOL_ABI, provider as any);
    const data = await pool.getUserAccountData(wallet);

    return {
      totalCollateralUsd: ethers.formatUnits(data[0], 8),
      totalDebtUsd: ethers.formatUnits(data[1], 8),
      availableBorrowsUsd: ethers.formatUnits(data[2], 8),
      liquidationThreshold: (Number(data[3]) / 10000).toFixed(4),
      ltv: (Number(data[4]) / 10000).toFixed(4),
      healthFactor: data[5] === ethers.MaxUint256
        ? "Infinity"
        : ethers.formatUnits(data[5], 18),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[protocols] Aave account health failed: ${msg}\n`);
    return null;
  }
}

/**
 * Get Aave V3 user reserve data for a specific asset.
 */
export async function getAaveUserReserve(
  asset: string,
  wallet: string,
  chain: ChainConfig,
): Promise<LendingPosition | null> {
  try {
    const provider = getProvider(chain);
    const addrs = chain.chainId === 8453 ? CONTRACTS.base : null;
    if (!addrs) return null;

    const dataProvider = new ethers.Contract(
      addrs.aavePoolDataProvider,
      AAVE_DATA_PROVIDER_ABI,
      provider as any,
    );

    const data = await dataProvider.getUserReserveData(asset, wallet);
    if (!data || data.length < 9) return null;
    const reserveData = await dataProvider.getReserveData(asset);
    if (!reserveData || reserveData.length < 7) return null;

    return {
      protocol: "Aave V3",
      asset: asset,
      assetAddress: asset,
      supplied: (data[0] as bigint).toString(),
      borrowed: ((data[1] as bigint) + (data[2] as bigint)).toString(),
      supplyAPY: Number(ethers.formatUnits(reserveData[5], 27)) * 100,
      borrowAPY: Number(ethers.formatUnits(reserveData[6], 27)) * 100,
      collateralEnabled: data[8] as boolean,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[protocols] Aave user reserve failed: ${msg}\n`);
    return null;
  }
}

/**
 * Get all Aave V3 reserve tokens on the chain.
 */
export async function getAaveReserveTokens(
  chain: ChainConfig,
): Promise<Array<{ symbol: string; address: string }>> {
  try {
    const provider = getProvider(chain);
    const addrs = chain.chainId === 8453 ? CONTRACTS.base : null;
    if (!addrs) return [];

    const dataProvider = new ethers.Contract(
      addrs.aavePoolDataProvider,
      AAVE_DATA_PROVIDER_ABI,
      provider as any,
    );

    const tokens = await dataProvider.getAllReservesTokens();
    return tokens.map((t: [string, string]) => ({
      symbol: t[0],
      address: t[1],
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[protocols] Aave reserve tokens failed: ${msg}\n`);
    return [];
  }
}

/**
 * Get best swap quote across DEXes.
 */
export async function getBestSwapQuote(
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  chain: ChainConfig,
): Promise<{ best: SwapQuote | null; quotes: SwapQuote[] }> {
  const quotes: SwapQuote[] = [];

  // Try multiple Uniswap fee tiers in parallel
  const uniFeeTiers = [500, 3000, 10000];
  const uniPromises = uniFeeTiers.map((fee) =>
    getUniswapQuote(tokenIn, tokenOut, amountIn, chain, fee),
  );
  const aeroPromise = getAerodromeQuote(tokenIn, tokenOut, amountIn, chain);

  const results = await Promise.allSettled([...uniPromises, aeroPromise]);

  for (const r of results) {
    if (r.status === "fulfilled" && r.value) {
      quotes.push(r.value);
    }
  }

  // Sort by amountOut descending (best price first)
  quotes.sort((a, b) => {
    const aOut = BigInt(a.amountOut);
    const bOut = BigInt(b.amountOut);
    if (bOut > aOut) return 1;
    if (bOut < aOut) return -1;
    return 0;
  });

  return { best: quotes[0] ?? null, quotes };
}
