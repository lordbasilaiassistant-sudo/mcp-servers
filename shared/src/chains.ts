/**
 * Chain configurations for EVM networks.
 * Add new chains here — all MCP servers reference this.
 */

export interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  fallbackRpcUrl?: string;
  explorerUrl: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  /** Well-known token addresses on this chain */
  tokens: Record<string, { address: string; decimals: number }>;
}

export const CHAINS: Record<string, ChainConfig> = {
  base: {
    chainId: 8453,
    name: "Base",
    rpcUrl: "https://mainnet.base.org",
    fallbackRpcUrl: "https://base.llamarpc.com",
    explorerUrl: "https://basescan.org",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    tokens: {
      WETH: { address: "0x4200000000000000000000000000000000000006", decimals: 18 },
      USDC: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
      USDbC: { address: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", decimals: 6 },
      DAI: { address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", decimals: 18 },
      AERO: { address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", decimals: 18 },
      DEGEN: { address: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed", decimals: 18 },
      BRETT: { address: "0x532f27101965dd16442E59d40670FaF5eBB142E4", decimals: 18 },
      TOSHI: { address: "0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4", decimals: 18 },
      OBSD: { address: "0x291AaF4729BaB2528B08d8fE248272b208Ce84FF", decimals: 18 },
    },
  },
  ethereum: {
    chainId: 1,
    name: "Ethereum",
    rpcUrl: "https://eth.llamarpc.com",
    explorerUrl: "https://etherscan.io",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    tokens: {
      WETH: { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18 },
      USDC: { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
      USDT: { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
      DAI: { address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", decimals: 18 },
    },
  },
  arbitrum: {
    chainId: 42161,
    name: "Arbitrum One",
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    explorerUrl: "https://arbiscan.io",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    tokens: {
      WETH: { address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", decimals: 18 },
      USDC: { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
      ARB: { address: "0x912CE59144191C1204E64559FE8253a0e49E6548", decimals: 18 },
    },
  },
};

export function getChain(nameOrId: string | number): ChainConfig | undefined {
  if (typeof nameOrId === "number") {
    return Object.values(CHAINS).find((c) => c.chainId === nameOrId);
  }
  return CHAINS[nameOrId.toLowerCase()];
}
