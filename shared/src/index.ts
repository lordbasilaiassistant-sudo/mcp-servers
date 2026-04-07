export { mcpResult, mcpError, requireEnv, type McpToolResult } from "./mcp-helpers.js";
export { getProvider, getSigner, getBaseProvider, getBaseSigner, ERC20_ABI } from "./evm-client.js";
export { CHAINS, getChain, type ChainConfig } from "./chains.js";
export type { TokenBalance, WalletInfo, TransactionResult } from "./types.js";

// Billing & rate limiting
export {
  validateApiKey,
  generateApiKey,
  clearBillingCache,
  KEY_PURCHASE_URL,
  KEY_HELP_TEXT,
  type BillingTier,
  type BillingResult,
} from "./billing.js";
export {
  checkRateLimit,
  peekRateLimit,
  clearRateLimits,
  RATE_LIMITS,
  type RateLimitConfig,
  type RateLimitResult,
} from "./rate-limiter.js";
export {
  premiumTool,
  freeTool,
  type ToolHandler,
  type PremiumToolOptions,
  type FreeToolOptions,
} from "./tool-wrapper.js";
