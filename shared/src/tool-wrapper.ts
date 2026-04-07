/**
 * Higher-order wrappers for MCP tool handlers with billing and rate limiting.
 */

import { validateApiKey, KEY_PURCHASE_URL, type BillingResult } from "./billing.js";
import { checkRateLimit, type RateLimitConfig, RATE_LIMITS } from "./rate-limiter.js";
import { type McpToolResult } from "./mcp-helpers.js";

// -- Types --------------------------------------------------------------------

export type ToolHandler<T extends Record<string, unknown> = Record<string, unknown>> = (
  args: T,
) => Promise<McpToolResult>;

export interface PremiumToolOptions {
  productId: string;
  toolName: string;
  relatedTools?: string[];
  freeFallback?: "block" | "degrade";
  freeRateLimit?: RateLimitConfig;
}

export interface FreeToolOptions {
  toolName: string;
  rateLimit?: RateLimitConfig;
  relatedTools?: string[];
}

// -- Helpers ------------------------------------------------------------------

/** Max session ID length to prevent memory abuse */
const MAX_SESSION_ID_LENGTH = 128;
/** Only allow alphanumeric, hyphens, underscores in session IDs */
const SESSION_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

function getSessionId(args: Record<string, unknown>): string {
  const raw =
    (args._sessionId as string) ??
    (args._clientId as string) ??
    "anonymous";

  // Sanitize: truncate, validate format, fallback to "anonymous"
  const trimmed = String(raw).slice(0, MAX_SESSION_ID_LENGTH);
  return SESSION_ID_REGEX.test(trimmed) ? trimmed : "anonymous";
}

function enrichResponse(
  result: McpToolResult,
  meta: {
    tier: string;
    remaining?: number;
    suggestion?: string;
    relatedTools?: string[];
    rateLimitRemaining?: number;
    rateLimitResetsAt?: number;
  },
): McpToolResult {
  const firstContent = result.content[0];
  if (!firstContent || firstContent.type !== "text") return result;

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(firstContent.text);
  } catch {
    data = { result: firstContent.text };
  }

  data._billing = {
    tier: meta.tier,
    ...(meta.remaining !== undefined ? { remaining: meta.remaining } : {}),
    ...(meta.rateLimitRemaining !== undefined
      ? { rateLimitRemaining: meta.rateLimitRemaining }
      : {}),
    ...(meta.rateLimitResetsAt !== undefined
      ? { rateLimitResetsAt: new Date(meta.rateLimitResetsAt).toISOString() }
      : {}),
    ...(meta.suggestion ? { suggestion: meta.suggestion } : {}),
    ...(meta.relatedTools?.length ? { relatedTools: meta.relatedTools } : {}),
  };

  return {
    ...result,
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function billingError(
  reason: string,
  relatedTools?: string[],
): McpToolResult {
  const data: Record<string, unknown> = {
    error: "billing_required",
    message: reason,
    suggestion: "Get an API key at " + KEY_PURCHASE_URL + " and pass it as the \"api_key\" parameter.",
  };
  if (relatedTools?.length) {
    data.relatedTools = relatedTools;
  }
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    isError: true,
  };
}

function rateLimitError(
  toolName: string,
  retryAfterSeconds: number,
  relatedTools?: string[],
): McpToolResult {
  const data: Record<string, unknown> = {
    error: "rate_limit_exceeded",
    message: "Free tier rate limit reached for " + toolName + ". Resets in " + retryAfterSeconds + " seconds.",
    retryAfterSeconds,
    suggestion: "Wait " + retryAfterSeconds + "s, or upgrade to premium for unlimited access: " + KEY_PURCHASE_URL,
  };
  if (relatedTools?.length) {
    data.relatedTools = relatedTools;
  }
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    isError: true,
  };
}

// -- Public wrappers ----------------------------------------------------------

/**
 * Wrap a tool handler to require a valid premium API key.
 *
 * The wrapped handler expects api_key in its args object.
 * If the key is missing or invalid and freeFallback is "block", access is denied.
 * If freeFallback is "degrade", the tool runs with rate limiting instead.
 */
export function premiumTool<T extends Record<string, unknown>>(
  handler: ToolHandler<T>,
  options: PremiumToolOptions,
): ToolHandler<T & { api_key?: string }> {
  const {
    productId,
    toolName,
    relatedTools,
    freeFallback = "block",
    freeRateLimit = RATE_LIMITS.expensive,
  } = options;

  return async (args: T & { api_key?: string }): Promise<McpToolResult> => {
    const apiKey = args.api_key;
    const billing: BillingResult = await validateApiKey(apiKey, productId);

    // Premium access
    if (billing.tier === "premium" && billing.valid) {
      const result = await handler(args);
      return enrichResponse(result, {
        tier: "premium",
        remaining: billing.remaining,
        relatedTools,
      });
    }

    // Key provided but invalid
    if (apiKey && !billing.valid) {
      return billingError(
        billing.reason ?? "Invalid API key.",
        relatedTools,
      );
    }

    // No key / free tier
    if (freeFallback === "block") {
      return billingError(
        toolName + " is a premium tool. Pass your API key as the \"api_key\" parameter to use it.",
        relatedTools,
      );
    }

    // Degraded mode with rate limiting
    const sessionId = getSessionId(args);
    const rl = checkRateLimit(sessionId, toolName, freeRateLimit);

    if (!rl.allowed) {
      return rateLimitError(toolName, rl.retryAfterSeconds, relatedTools);
    }

    const result = await handler(args);
    return enrichResponse(result, {
      tier: "free",
      rateLimitRemaining: rl.remaining,
      rateLimitResetsAt: rl.resetsAt,
      suggestion: "You are using " + toolName + " on the free tier (" + rl.remaining + " calls remaining). Upgrade at " + KEY_PURCHASE_URL + " for unlimited access.",
      relatedTools,
    });
  };
}

/**
 * Wrap a tool handler with free-tier rate limiting.
 *
 * No API key needed. If rate limit is exceeded, returns a helpful error.
 * If an api_key IS provided, rate limiting is bypassed for premium users.
 */
export function freeTool<T extends Record<string, unknown>>(
  handler: ToolHandler<T>,
  options: FreeToolOptions,
): ToolHandler<T & { api_key?: string }> {
  const {
    toolName,
    rateLimit = RATE_LIMITS.standard,
    relatedTools,
  } = options;

  return async (args: T & { api_key?: string }): Promise<McpToolResult> => {
    const apiKey = args.api_key;

    // If they passed a premium key, skip rate limiting
    if (apiKey && apiKey.trim() !== "") {
      const billing = await validateApiKey(apiKey, "any");
      if (billing.tier === "premium" && billing.valid) {
        const result = await handler(args);
        return enrichResponse(result, {
          tier: "premium",
          remaining: billing.remaining,
          relatedTools,
        });
      }
    }

    // Free tier with rate limit
    const sessionId = getSessionId(args);
    const rl = checkRateLimit(sessionId, toolName, rateLimit);

    if (!rl.allowed) {
      return rateLimitError(toolName, rl.retryAfterSeconds, relatedTools);
    }

    const result = await handler(args);
    return enrichResponse(result, {
      tier: "free",
      rateLimitRemaining: rl.remaining,
      rateLimitResetsAt: rl.resetsAt,
      relatedTools,
    });
  };
}
