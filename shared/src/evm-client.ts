/**
 * Shared EVM client — provider and signer management.
 * All MCP servers use this for consistent RPC access.
 */

import { ethers } from "ethers";
import { CHAINS, type ChainConfig } from "./chains.js";

let _providers: Map<number, ethers.JsonRpcProvider> = new Map();

/**
 * Get or create a cached provider for a chain.
 * Uses RPC_URL env var if set, otherwise falls back to chain defaults.
 */
export function getProvider(chain: ChainConfig): ethers.JsonRpcProvider {
  const existing = _providers.get(chain.chainId);
  if (existing) return existing;

  const rpcUrl = process.env.RPC_URL ?? chain.rpcUrl;
  const provider = new ethers.JsonRpcProvider(rpcUrl, chain.chainId);
  _providers.set(chain.chainId, provider);
  return provider;
}

/**
 * Get a signer from a private key + provider.
 * Returns null if DEPLOYER_PRIVATE_KEY is not set.
 */
export function getSigner(chain: ChainConfig): ethers.Wallet | null {
  const key = process.env.DEPLOYER_PRIVATE_KEY;
  if (!key) return null;
  return new ethers.Wallet(key, getProvider(chain));
}

/**
 * Get the default Base provider (most common use case).
 */
export function getBaseProvider(): ethers.JsonRpcProvider {
  return getProvider(CHAINS.base);
}

/**
 * Get the default Base signer.
 */
export function getBaseSigner(): ethers.Wallet | null {
  return getSigner(CHAINS.base);
}

/**
 * ERC-20 minimal ABI for balance checks.
 */
export const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address, uint256) returns (bool)",
  "function approve(address, uint256) returns (bool)",
  "function allowance(address, address) view returns (uint256)",
];
