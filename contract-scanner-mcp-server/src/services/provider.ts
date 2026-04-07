/**
 * Provider management — cached ethers providers per chain.
 */

import { ethers } from "ethers";

export interface ChainInfo {
  chainId: number;
  name: string;
  rpcUrl: string;
  explorerUrl: string;
  explorerApiUrl: string;
  apiKeyEnv: string;
}

const CHAINS: Record<string, ChainInfo> = {
  base: {
    chainId: 8453,
    name: "Base",
    rpcUrl: "https://mainnet.base.org",
    explorerUrl: "https://basescan.org",
    explorerApiUrl: "https://api.basescan.org/api",
    apiKeyEnv: "BASESCAN_API_KEY",
  },
  ethereum: {
    chainId: 1,
    name: "Ethereum",
    rpcUrl: "https://eth.llamarpc.com",
    explorerUrl: "https://etherscan.io",
    explorerApiUrl: "https://api.etherscan.io/api",
    apiKeyEnv: "ETHERSCAN_API_KEY",
  },
  eth: {
    chainId: 1,
    name: "Ethereum",
    rpcUrl: "https://eth.llamarpc.com",
    explorerUrl: "https://etherscan.io",
    explorerApiUrl: "https://api.etherscan.io/api",
    apiKeyEnv: "ETHERSCAN_API_KEY",
  },
  arbitrum: {
    chainId: 42161,
    name: "Arbitrum One",
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    explorerUrl: "https://arbiscan.io",
    explorerApiUrl: "https://api.arbiscan.io/api",
    apiKeyEnv: "ARBISCAN_API_KEY",
  },
  arb: {
    chainId: 42161,
    name: "Arbitrum One",
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    explorerUrl: "https://arbiscan.io",
    explorerApiUrl: "https://api.arbiscan.io/api",
    apiKeyEnv: "ARBISCAN_API_KEY",
  },
};

const providers = new Map<number, ethers.JsonRpcProvider>();

export function resolveChain(name: string): ChainInfo {
  const chain = CHAINS[name.toLowerCase()];
  if (!chain) {
    throw new Error(`Unknown chain "${name}". Supported: base, ethereum, arbitrum`);
  }
  return chain;
}

export function getProvider(chain: ChainInfo): ethers.JsonRpcProvider {
  const existing = providers.get(chain.chainId);
  if (existing) return existing;

  // Only use RPC_URL env override for the default chain (Base). Other chains use their own RPC.
  const rpcUrl = (chain.chainId === 8453 && process.env.RPC_URL) ? process.env.RPC_URL : chain.rpcUrl;
  const provider = new ethers.JsonRpcProvider(rpcUrl, chain.chainId);
  providers.set(chain.chainId, provider);
  return provider;
}

export function getExplorerApiKey(chain: ChainInfo): string | undefined {
  return process.env[chain.apiKeyEnv];
}
