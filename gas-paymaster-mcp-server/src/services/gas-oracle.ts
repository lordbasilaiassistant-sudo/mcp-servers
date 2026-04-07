/**
 * Gas Oracle — gas price tracking, prediction, and ETH/USD conversion.
 *
 * Maintains a rolling 24h window of gas price samples in memory.
 * Provides current prices, historical stats, and optimal send-time predictions.
 */

import { ethers } from "ethers";
import { getProvider, CHAINS, type ChainConfig } from "@thryx/mcp-shared";

// ── Types ────────────────────────────────────────────────────────────────────

export interface GasPriceSample {
  timestamp: number;
  gasPrice: bigint;
  maxFeePerGas: bigint | null;
  maxPriorityFeePerGas: bigint | null;
  blockNumber: number;
}

export interface GasPrices {
  slow: bigint;
  standard: bigint;
  fast: bigint;
  baseFee: bigint | null;
  maxPriorityFeePerGas: bigint | null;
  blockNumber: number;
  timestamp: number;
}

export interface GasEstimate {
  gasLimit: bigint;
  gasCostWei: bigint;
  gasCostEth: string;
  gasCostUsd: string;
  gasPrice: bigint;
  speeds: {
    slow: { gasCostEth: string; gasCostUsd: string; waitSeconds: number };
    standard: { gasCostEth: string; gasCostUsd: string; waitSeconds: number };
    fast: { gasCostEth: string; gasCostUsd: string; waitSeconds: number };
  };
}

export interface GasHistory {
  hours: number;
  sampleCount: number;
  average: string;
  min: string;
  max: string;
  current: string;
  currentPercentile: number | null;
  bestWindows: Array<{ hour: number; avgGwei: string }>;
  trend: "rising" | "falling" | "stable";
  note?: string;
}

// ── In-memory price store ────────────────────────────────────────────────────

const ROLLING_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const SAMPLE_INTERVAL_MS = 30 * 1000; // 30 seconds min between samples

const priceHistory: Map<number, GasPriceSample[]> = new Map();
let lastSampleTime: Map<number, number> = new Map();

function getHistory(chainId: number): GasPriceSample[] {
  if (!priceHistory.has(chainId)) {
    priceHistory.set(chainId, []);
  }
  return priceHistory.get(chainId)!;
}

function pruneOldSamples(chainId: number): void {
  const history = getHistory(chainId);
  const cutoff = Date.now() - ROLLING_WINDOW_MS;
  const firstValid = history.findIndex((s) => s.timestamp >= cutoff);
  if (firstValid > 0) {
    history.splice(0, firstValid);
  }
}

async function recordSample(chain: ChainConfig): Promise<GasPriceSample | null> {
  const now = Date.now();
  const last = lastSampleTime.get(chain.chainId) ?? 0;
  if (now - last < SAMPLE_INTERVAL_MS) return null;

  try {
    const provider = getProvider(chain);
    const [feeData, block] = await Promise.all([
      provider.getFeeData(),
      provider.getBlock("latest"),
    ]);

    if (!feeData.gasPrice || !block) return null;

    const sample: GasPriceSample = {
      timestamp: now,
      gasPrice: feeData.gasPrice,
      maxFeePerGas: feeData.maxFeePerGas,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
      blockNumber: block.number,
    };

    getHistory(chain.chainId).push(sample);
    lastSampleTime.set(chain.chainId, now);
    pruneOldSamples(chain.chainId);

    return sample;
  } catch {
    return null;
  }
}

// ── ETH price (simple cache) ─────────────────────────────────────────────────

let cachedEthPrice: number | null = null;
let ethPriceFetchedAt = 0;
const ETH_PRICE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get current ETH price in USD.
 * Uses Uniswap V3 USDC/WETH pool on-chain, falling back to a hardcoded estimate.
 */
export async function getEthPriceUsd(chain?: ChainConfig): Promise<number> {
  const now = Date.now();
  if (cachedEthPrice && now - ethPriceFetchedAt < ETH_PRICE_TTL_MS) {
    return cachedEthPrice;
  }

  try {
    // Read USDC/WETH pool price via slot0 on Base Uniswap V3
    const baseChain = chain ?? CHAINS.base;
    const provider = getProvider(baseChain);

    // Chainlink ETH/USD price feed on Base
    const CHAINLINK_ETH_USD = "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70";
    const priceFeedAbi = [
      "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)",
    ];
    const priceFeed = new ethers.Contract(CHAINLINK_ETH_USD, priceFeedAbi, provider as any);
    const [, answer] = await priceFeed.latestRoundData();
    const price = Number(answer) / 1e8;

    if (price > 0 && price < 100000) {
      cachedEthPrice = price;
      ethPriceFetchedAt = now;
      return price;
    }
  } catch {
    // Chainlink failed — try fallback
  }

  // Fallback: use cached or a conservative estimate
  if (cachedEthPrice) return cachedEthPrice;
  return 2500; // Conservative fallback
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Resolve chain name to ChainConfig. Defaults to Base.
 */
export function resolveChain(nameOrId?: string): ChainConfig {
  if (!nameOrId) return CHAINS.base;
  const lower = nameOrId.toLowerCase();
  if (CHAINS[lower]) return CHAINS[lower];
  const byId = Object.values(CHAINS).find(
    (c) => c.chainId === Number(nameOrId),
  );
  return byId ?? CHAINS.base;
}

/**
 * Get current gas prices with slow/standard/fast tiers.
 */
export async function getCurrentGasPrices(chain: ChainConfig): Promise<GasPrices> {
  const provider = getProvider(chain);
  const [feeData, block] = await Promise.all([
    provider.getFeeData(),
    provider.getBlock("latest"),
  ]);

  if (!feeData.gasPrice || !block) {
    throw new Error("Failed to fetch gas prices from RPC");
  }

  // Record sample for history
  await recordSample(chain);

  const base = feeData.gasPrice;
  // slow = 90% of current, standard = current, fast = 120% of current
  const slow = (base * 90n) / 100n;
  const fast = (base * 120n) / 100n;

  return {
    slow,
    standard: base,
    fast,
    baseFee: feeData.maxFeePerGas,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
    blockNumber: block.number,
    timestamp: Date.now(),
  };
}

/**
 * Estimate gas for a transaction.
 */
export async function estimateGas(
  chain: ChainConfig,
  to: string,
  data?: string,
  value?: string,
): Promise<GasEstimate> {
  if (!ethers.isAddress(to)) {
    throw new Error("Invalid destination address. Expected 0x followed by 40 hex characters.");
  }

  const provider = getProvider(chain);
  const prices = await getCurrentGasPrices(chain);
  const ethPrice = await getEthPriceUsd(chain);

  const tx: { to: string; data?: string; value?: bigint } = { to };
  if (data) tx.data = data;
  if (value) tx.value = ethers.parseEther(value);

  let gasLimit: bigint;
  try {
    gasLimit = await provider.estimateGas(tx);
    // Add 20% buffer
    gasLimit = (gasLimit * 120n) / 100n;
  } catch {
    // Default to 21000 for simple transfers, 100000 for contract calls
    gasLimit = data ? 100000n : 21000n;
  }

  const gasCostWei = gasLimit * prices.standard;
  const gasCostEth = ethers.formatEther(gasCostWei);
  const gasCostUsd = (parseFloat(gasCostEth) * ethPrice).toFixed(4);

  const calcSpeed = (price: bigint, waitSec: number) => {
    const cost = gasLimit * price;
    const eth = ethers.formatEther(cost);
    return {
      gasCostEth: eth,
      gasCostUsd: (parseFloat(eth) * ethPrice).toFixed(4),
      waitSeconds: waitSec,
    };
  };

  return {
    gasLimit,
    gasCostWei,
    gasCostEth,
    gasCostUsd,
    gasPrice: prices.standard,
    speeds: {
      slow: calcSpeed(prices.slow, 30),
      standard: calcSpeed(prices.standard, 15),
      fast: calcSpeed(prices.fast, 5),
    },
  };
}

/**
 * Get gas price history and analytics for a chain.
 */
export async function getGasHistory(
  chain: ChainConfig,
  hours: number = 24,
): Promise<GasHistory> {
  // Ensure we have at least one current sample
  await recordSample(chain);

  const history = getHistory(chain.chainId);
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const relevant = history.filter((s) => s.timestamp >= cutoff);

  if (relevant.length === 0) {
    // No history yet — fetch current and return minimal data
    const prices = await getCurrentGasPrices(chain);
    const currentGwei = ethers.formatUnits(prices.standard, "gwei");
    return {
      hours,
      sampleCount: 1,
      average: currentGwei,
      min: currentGwei,
      max: currentGwei,
      current: currentGwei,
      currentPercentile: null,
      bestWindows: [],
      trend: "stable",
      note: "Insufficient data for percentile calculation (need at least 5 samples). Gas oracle is warming up.",
    };
  }

  const gasPrices = relevant.map((s) => s.gasPrice);
  const sorted = [...gasPrices].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const current = gasPrices[gasPrices.length - 1];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const sum = gasPrices.reduce((a, b) => a + b, 0n);
  const avg = sum / BigInt(gasPrices.length);

  // Current percentile — requires minimum 5 samples for meaningful calculation
  const MIN_PERCENTILE_SAMPLES = 5;
  let currentPercentile: number | null;
  let note: string | undefined;
  if (relevant.length < MIN_PERCENTILE_SAMPLES) {
    currentPercentile = null;
    note = `Insufficient data for percentile calculation (${relevant.length}/${MIN_PERCENTILE_SAMPLES} samples). Gas oracle is warming up.`;
  } else {
    const belowCurrent = sorted.filter((p) => p <= current).length;
    currentPercentile = Math.round((belowCurrent / sorted.length) * 100);
  }

  // Best windows by hour
  const hourBuckets: Map<number, bigint[]> = new Map();
  for (const s of relevant) {
    const h = new Date(s.timestamp).getUTCHours();
    if (!hourBuckets.has(h)) hourBuckets.set(h, []);
    hourBuckets.get(h)!.push(s.gasPrice);
  }

  const bestWindows = Array.from(hourBuckets.entries())
    .map(([hour, prices]) => ({
      hour,
      avgGwei: ethers.formatUnits(
        prices.reduce((a, b) => a + b, 0n) / BigInt(prices.length),
        "gwei",
      ),
    }))
    .sort((a, b) => parseFloat(a.avgGwei) - parseFloat(b.avgGwei))
    .slice(0, 3);

  // Trend: compare last 25% vs first 25%
  const quarter = Math.max(1, Math.floor(relevant.length / 4));
  const recentAvg =
    gasPrices.slice(-quarter).reduce((a, b) => a + b, 0n) / BigInt(quarter);
  const earlyAvg =
    gasPrices.slice(0, quarter).reduce((a, b) => a + b, 0n) / BigInt(quarter);
  const diff = recentAvg > earlyAvg ? recentAvg - earlyAvg : earlyAvg - recentAvg;
  const threshold = earlyAvg / 10n; // 10% change threshold
  const trend: "rising" | "falling" | "stable" =
    diff < threshold ? "stable" : recentAvg > earlyAvg ? "rising" : "falling";

  return {
    hours,
    sampleCount: relevant.length,
    average: ethers.formatUnits(avg, "gwei"),
    min: ethers.formatUnits(min, "gwei"),
    max: ethers.formatUnits(max, "gwei"),
    current: ethers.formatUnits(current, "gwei"),
    currentPercentile,
    bestWindows,
    trend,
    ...(note ? { note } : {}),
  };
}
