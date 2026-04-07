/**
 * Shared types across all MCP servers.
 */

export interface TokenBalance {
  symbol: string;
  address: string;
  balance: string;
  decimals: number;
  valueUsd?: string;
}

export interface WalletInfo {
  address: string;
  label?: string;
  ethBalance: string;
  tokens: TokenBalance[];
  chain: string;
  chainId: number;
  txCount: number;
  explorerUrl: string;
}

export interface TransactionResult {
  success: boolean;
  txHash: string;
  txUrl: string;
  gasUsed?: string;
  effectiveGasPrice?: string;
}
