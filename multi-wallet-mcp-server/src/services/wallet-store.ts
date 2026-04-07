/**
 * In-memory wallet store.
 * Wallets are generated ephemerally or loaded from WALLETS_JSON env var.
 * No private keys are ever returned to the MCP client.
 */

import { ethers } from "ethers";

interface StoredWallet {
  address: string;
  label: string;
  privateKey: string; // never exposed via MCP tools
  createdAt: string;
}

const wallets = new Map<string, StoredWallet>();

/**
 * Generate N new wallets and store them.
 * Returns public info only (no private keys).
 */
export function generateWallets(count: number, labelPrefix = "wallet"): Array<{ address: string; label: string }> {
  const result: Array<{ address: string; label: string }> = [];
  const startIdx = wallets.size;

  for (let i = 0; i < count; i++) {
    const wallet = ethers.Wallet.createRandom();
    const label = `${labelPrefix}-${startIdx + i}`;
    wallets.set(wallet.address.toLowerCase(), {
      address: wallet.address,
      label,
      privateKey: wallet.privateKey,
      createdAt: new Date().toISOString(),
    });
    result.push({ address: wallet.address, label });
  }

  return result;
}

/**
 * Import a wallet from a private key.
 */
export function importWallet(privateKey: string, label?: string): { address: string; label: string } | null {
  try {
    const wallet = new ethers.Wallet(privateKey);
    const addr = wallet.address.toLowerCase();
    const lbl = label ?? `imported-${wallets.size}`;
    wallets.set(addr, {
      address: wallet.address,
      label: lbl,
      privateKey: wallet.privateKey,
      createdAt: new Date().toISOString(),
    });
    return { address: wallet.address, label: lbl };
  } catch {
    return null;
  }
}

/**
 * List all stored wallets (public info only).
 */
export function listWallets(): Array<{ address: string; label: string; createdAt: string }> {
  return Array.from(wallets.values()).map((w) => ({
    address: w.address,
    label: w.label,
    createdAt: w.createdAt,
  }));
}

/**
 * Get a signer for a specific wallet address.
 * Used internally by tools that need to sign transactions.
 */
export function getWalletSigner(address: string, provider: ethers.Provider): ethers.Wallet | null {
  const stored = wallets.get(address.toLowerCase());
  if (!stored) return null;
  return new ethers.Wallet(stored.privateKey, provider);
}

/**
 * Get total wallet count.
 */
export function walletCount(): number {
  return wallets.size;
}

/**
 * Load wallets from the DEPLOYER_PRIVATE_KEY env var if set.
 * Called once on startup.
 */
export function loadFromEnv(): void {
  const key = process.env.DEPLOYER_PRIVATE_KEY;
  if (key) {
    importWallet(key, "deployer");
  }
}
