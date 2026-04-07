/**
 * Paymaster integration — interfaces with The Agent Cafe paymaster on Base.
 *
 * Manages gas tank credits, submits sponsored transactions,
 * and tracks gas spending.
 */

import { ethers } from "ethers";
import { getProvider, getSigner, CHAINS, type ChainConfig } from "@thryx/mcp-shared";
import { getEthPriceUsd } from "./gas-oracle.js";

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Paymaster contract address on Base mainnet.
 * Set via PAYMASTER_ADDRESS env var, or defaults to placeholder.
 */
export const PAYMASTER_ADDRESS =
  process.env.PAYMASTER_ADDRESS ?? "0x0000000000000000000000000000000000000000";

/** Deployer wallet — used for submitting sponsored txs. Configurable via env. */
const DEPLOYER_ADDRESS = process.env.DEPLOYER_ADDRESS ?? process.env.DEPLOYER_WALLET ?? "";

/**
 * Minimal ABI for interacting with the paymaster contract.
 * This is a placeholder — adapt to the actual Agent Cafe paymaster interface.
 */
const PAYMASTER_ABI = [
  "function gasTank(address) view returns (uint256)",
  "function depositGas() payable",
  "function sponsoredCall(address target, bytes calldata data, uint256 value) returns (bytes)",
  "event GasUsed(address indexed user, uint256 amount)",
  "event GasDeposited(address indexed user, uint256 amount)",
];

// ── Types ────────────────────────────────────────────────────────────────────

export interface TankStatus {
  wallet: string;
  balanceWei: string;
  balanceEth: string;
  balanceUsd: string;
  estimatedTxsRemaining: number;
  health: "full" | "healthy" | "low" | "critical" | "empty";
  suggestion: string;
}

export interface SponsoredTxResult {
  success: boolean;
  txHash: string;
  gasUsed: string;
  gasCostEth: string;
  gasCostUsd: string;
  remainingCredits: string;
  explorerUrl: string;
}

// ── Gas spending tracker ─────────────────────────────────────────────────────

interface SpendingRecord {
  txHash: string;
  gasUsed: bigint;
  timestamp: number;
}

const spendingLog: SpendingRecord[] = [];

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Check gas tank balance for a wallet.
 */
export async function checkTank(wallet?: string): Promise<TankStatus> {
  const chain = CHAINS.base;
  const provider = getProvider(chain);
  const targetWallet = wallet ?? DEPLOYER_ADDRESS;

  if (!targetWallet || !ethers.isAddress(targetWallet)) {
    throw new Error("No wallet address provided and DEPLOYER_ADDRESS is not configured. Pass a wallet address or set DEPLOYER_ADDRESS env var.");
  }
  const ethPrice = await getEthPriceUsd(chain);

  let balanceWei: bigint;

  if (PAYMASTER_ADDRESS === "0x0000000000000000000000000000000000000000") {
    // No paymaster configured — fall back to checking native ETH balance
    balanceWei = await provider.getBalance(targetWallet);
  } else {
    try {
      const paymaster = new ethers.Contract(PAYMASTER_ADDRESS, PAYMASTER_ABI, provider as any);
      balanceWei = await paymaster.gasTank(targetWallet);
    } catch {
      // Fallback to native balance if contract call fails
      balanceWei = await provider.getBalance(targetWallet);
    }
  }

  const balanceEth = ethers.formatEther(balanceWei);
  const balanceUsd = (parseFloat(balanceEth) * ethPrice).toFixed(2);

  // Estimate remaining txs based on average Base gas cost (~0.000005 ETH per tx)
  const avgTxCostWei = ethers.parseEther("0.000005");
  const estimatedTxsRemaining =
    avgTxCostWei > 0n ? Number(balanceWei / avgTxCostWei) : 0;

  // Health assessment
  let health: TankStatus["health"];
  let suggestion: string;

  if (balanceWei === 0n) {
    health = "empty";
    suggestion = "Gas tank is empty. Deposit ETH to the paymaster or eat at The Agent Cafe to refill credits.";
  } else if (estimatedTxsRemaining < 5) {
    health = "critical";
    suggestion = `Only ~${estimatedTxsRemaining} transactions remaining. Refill urgently — eat at The Agent Cafe or deposit ETH to the paymaster.`;
  } else if (estimatedTxsRemaining < 50) {
    health = "low";
    suggestion = `~${estimatedTxsRemaining} transactions remaining. Consider refilling soon.`;
  } else if (estimatedTxsRemaining < 500) {
    health = "healthy";
    suggestion = `Tank looks good with ~${estimatedTxsRemaining} estimated transactions remaining.`;
  } else {
    health = "full";
    suggestion = `Tank is full with ~${estimatedTxsRemaining} estimated transactions. No action needed.`;
  }

  return {
    wallet: targetWallet,
    balanceWei: balanceWei.toString(),
    balanceEth,
    balanceUsd,
    estimatedTxsRemaining,
    health,
    suggestion,
  };
}

/**
 * Check if the paymaster can cover a transaction of the given gas cost.
 */
export async function canPaymasterCover(
  gasCostWei: bigint,
  wallet?: string,
): Promise<{ covered: boolean; tankBalance: bigint; deficit: bigint }> {
  const tank = await checkTank(wallet);
  const tankBalance = BigInt(tank.balanceWei);
  const covered = tankBalance >= gasCostWei;
  const deficit = covered ? 0n : gasCostWei - tankBalance;

  return { covered, tankBalance, deficit };
}

/**
 * Send a sponsored transaction via the paymaster.
 * Falls back to direct send if paymaster is not configured.
 */
export async function sendSponsored(
  to: string,
  data?: string,
  value?: string,
): Promise<SponsoredTxResult> {
  const chain = CHAINS.base;
  const signer = getSigner(chain);
  const ethPrice = await getEthPriceUsd(chain);

  if (!signer) {
    throw new Error(
      "DEPLOYER_PRIVATE_KEY not set. Cannot send transactions without a signer.",
    );
  }

  // Check tank first
  const tank = await checkTank();
  if (tank.health === "empty") {
    throw new Error(
      "Gas tank is empty. Eat at The Agent Cafe to refill credits before sending transactions.",
    );
  }

  let txHash: string;
  let gasUsed: bigint;
  let gasCostWei: bigint;

  if (PAYMASTER_ADDRESS !== "0x0000000000000000000000000000000000000000") {
    // Use paymaster contract
    try {
      const paymaster = new ethers.Contract(PAYMASTER_ADDRESS, PAYMASTER_ABI, signer as any);
      const tx = await paymaster.sponsoredCall(
        to,
        data ?? "0x",
        value ? ethers.parseEther(value) : 0n,
      );
      const receipt = await tx.wait();
      if (!receipt) throw new Error("Paymaster transaction confirmation failed — no receipt returned");
      txHash = receipt.hash;
      gasUsed = receipt.gasUsed;
      gasCostWei = receipt.gasUsed * BigInt(receipt.gasPrice ?? 0);
    } catch (err: any) {
      const msg = err.message ?? "unknown error";
      const sanitized = msg.includes("insufficient") ? "Insufficient gas credits or balance"
        : msg.includes("revert") ? "Transaction reverted by contract"
        : msg.includes("nonce") ? "Nonce conflict — retry the transaction"
        : "Transaction execution failed";
      throw new Error(`Paymaster sponsored call failed: ${sanitized}`);
    }
  } else {
    // Direct send (no paymaster configured)
    const txRequest: ethers.TransactionRequest = { to };
    if (data) txRequest.data = data;
    if (value) txRequest.value = ethers.parseEther(value);

    const tx = await signer.sendTransaction(txRequest);
    const receipt = await tx.wait();
    if (!receipt) throw new Error("Transaction receipt not available");

    txHash = receipt.hash;
    gasUsed = receipt.gasUsed;
    gasCostWei = receipt.gasUsed * BigInt(receipt.gasPrice ?? 0);
  }

  // Log spending
  spendingLog.push({
    txHash,
    gasUsed,
    timestamp: Date.now(),
  });

  const gasCostEth = ethers.formatEther(gasCostWei);
  const gasCostUsd = (parseFloat(gasCostEth) * ethPrice).toFixed(4);

  // Check remaining credits
  const remainingTank = await checkTank();

  return {
    success: true,
    txHash,
    gasUsed: gasUsed.toString(),
    gasCostEth,
    gasCostUsd,
    remainingCredits: remainingTank.balanceEth,
    explorerUrl: `${chain.explorerUrl}/tx/${txHash}`,
  };
}

/**
 * Get recent gas spending records.
 */
export function getSpendingLog(): SpendingRecord[] {
  return [...spendingLog];
}
