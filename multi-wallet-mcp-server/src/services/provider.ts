/**
 * Provider management — cached providers per chain.
 */

import { ethers } from "ethers";
import { CHAINS, type ChainConfig } from "../constants.js";

const providers = new Map<number, ethers.JsonRpcProvider>();

export function getProvider(chain: ChainConfig): ethers.JsonRpcProvider {
  const existing = providers.get(chain.chainId);
  if (existing) return existing;

  const rpcUrl = process.env.RPC_URL ?? chain.rpcUrl;
  const provider = new ethers.JsonRpcProvider(rpcUrl, chain.chainId);
  providers.set(chain.chainId, provider);
  return provider;
}

export function resolveChain(chainName?: string): ChainConfig {
  const name = chainName?.toLowerCase() ?? "base";
  const chain = CHAINS[name];
  if (!chain) throw new Error(`Unknown chain: ${chainName}. Supported: ${Object.keys(CHAINS).join(", ")}`);
  return chain;
}

export function getSigner(chain: ChainConfig): ethers.Wallet | null {
  const key = process.env.DEPLOYER_PRIVATE_KEY;
  if (!key) return null;
  return new ethers.Wallet(key, getProvider(chain));
}
