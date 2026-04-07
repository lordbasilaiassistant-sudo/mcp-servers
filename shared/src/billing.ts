/**
 * API key billing middleware for Thryx MCP servers.
 *
 * Validates API keys against Stripe to check if the customer has an active
 * purchase for the given product. Results are cached in-memory with a 1-hour TTL.
 *
 * API key format: "thryx_live_" + 32 hex characters
 * Environment: STRIPE_LIVE_KEY must be set for premium validation.
 */

import { randomBytes, timingSafeEqual } from "crypto";

// ── Types ────────────────────────────────────────────────────────────────────

export type BillingTier = "free" | "premium";

export interface BillingResult {
  valid: boolean;
  tier: BillingTier;
  /** Remaining premium calls this period (undefined for free tier). */
  remaining?: number;
  /** Customer ID from Stripe (undefined for free tier). */
  customerId?: string;
  /** Human-readable reason when valid is false. */
  reason?: string;
}

interface CacheEntry {
  result: BillingResult;
  expiresAt: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const API_KEY_PREFIX = "thryx_live_";
const API_KEY_REGEX = /^thryx_live_[a-f0-9]{32}$/;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const CACHE_MAX_SIZE = 10_000; // Prevent unbounded memory growth
const STRIPE_API_BASE = "https://api.stripe.com/v1";
const STRIPE_TIMEOUT_MS = 10_000; // 10 second timeout for Stripe calls

// Circuit breaker: after 3 consecutive Stripe failures, stop trying for 60s
let stripeFailCount = 0;
let stripeCircuitOpenUntil = 0;
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 60_000;

const KEY_PURCHASE_URL = "https://thryx.fun/api-keys";
const KEY_HELP_TEXT =
  `To get a premium API key, visit ${KEY_PURCHASE_URL} — ` +
  `keys are linked to your Stripe purchase and unlock full tool access.`;

// ── In-memory cache ──────────────────────────────────────────────────────────

const cache = new Map<string, CacheEntry>();

function getCached(cacheKey: string): BillingResult | null {
  const entry = cache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(cacheKey);
    return null;
  }
  return entry.result;
}

function setCache(cacheKey: string, result: BillingResult): void {
  // Evict oldest entries if cache is too large
  if (cache.size >= CACHE_MAX_SIZE) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(cacheKey, { result, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** Visible for testing. */
export function clearBillingCache(): void {
  cache.clear();
}

// ── Stripe helpers ───────────────────────────────────────────────────────────

function getStripeKey(): string | null {
  return process.env.STRIPE_LIVE_KEY ?? null;
}

async function stripeGet(path: string, stripeKey: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STRIPE_TIMEOUT_MS);

  try {
    const res = await fetch(`${STRIPE_API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${stripeKey}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      // SECURITY: Do NOT log the raw Stripe response body — may contain sensitive data
      throw new Error(`Stripe API error: HTTP ${res.status}`);
    }
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Safely extract array data from a Stripe list response.
 * Returns empty array if response structure is unexpected.
 */
function safeListData<T>(response: unknown): T[] {
  if (
    typeof response === "object" &&
    response !== null &&
    "data" in response &&
    Array.isArray((response as { data: unknown }).data)
  ) {
    return (response as { data: T[] }).data;
  }
  return [];
}

/**
 * Look up a Stripe customer by metadata `api_key` and check they own
 * an active subscription or a one-time purchase for `productId`.
 */
async function verifyKeyWithStripe(
  apiKey: string,
  productId: string,
  stripeKey: string,
): Promise<BillingResult> {
  // SECURITY: apiKey is already validated by API_KEY_REGEX (only [a-f0-9] after prefix)
  // so it's safe to interpolate into the Stripe search query.
  // The regex ensures no Stripe query operators (quotes, colons, brackets) can be injected.
  const searchQuery = encodeURIComponent(`metadata["api_key"]:"${apiKey}"`);
  const customersRaw = await stripeGet(
    `/customers/search?query=${searchQuery}`,
    stripeKey,
  );

  const customers = safeListData<{ id: string }>(customersRaw);

  if (!customers.length) {
    return {
      valid: false,
      tier: "free",
      reason: "API key not found. " + KEY_HELP_TEXT,
    };
  }

  const customer = customers[0];

  // 2. Check active subscriptions for this product
  const subsRaw = await stripeGet(
    `/subscriptions?customer=${customer.id}&status=active&limit=100`,
    stripeKey,
  );

  const subs = safeListData<{
    items: { data: Array<{ price: { product: string } }> };
  }>(subsRaw);

  const hasActiveSub = subs.some((sub) =>
    sub.items?.data?.some((item) => item.price?.product === productId),
  );

  if (hasActiveSub) {
    return { valid: true, tier: "premium", customerId: customer.id };
  }

  // 3. Fallback: check one-time payments (payment_intents succeeded)
  const piRaw = await stripeGet(
    `/payment_intents?customer=${customer.id}&limit=100`,
    stripeKey,
  );

  const paymentIntents = safeListData<{
    status: string;
    metadata?: Record<string, string>;
  }>(piRaw);

  const hasPurchase = paymentIntents.some(
    (pi) =>
      pi.status === "succeeded" &&
      pi.metadata?.product_id === productId,
  );

  if (hasPurchase) {
    return { valid: true, tier: "premium", customerId: customer.id };
  }

  return {
    valid: false,
    tier: "free",
    reason:
      `API key is valid but no active purchase found for this product. ` +
      `Visit ${KEY_PURCHASE_URL} to upgrade.`,
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Validate an API key for a specific product.
 *
 * - No key → free tier (valid: true, tier: "free")
 * - Invalid format → error
 * - Valid format → check Stripe (cached for 1 hour)
 *
 * @param key       The API key string, or undefined/empty for free tier.
 * @param productId Stripe product ID the tool belongs to.
 */
export async function validateApiKey(
  key: string | undefined,
  productId: string,
): Promise<BillingResult> {
  // No key = free tier, perfectly fine
  if (!key || key.trim() === "") {
    return { valid: true, tier: "free" };
  }

  // Format check (strict: only thryx_live_ + 32 hex chars)
  if (!API_KEY_REGEX.test(key)) {
    return {
      valid: false,
      tier: "free",
      reason:
        `Invalid API key format. Keys start with "${API_KEY_PREFIX}" followed by 32 hex characters. ` +
        KEY_HELP_TEXT,
    };
  }

  // Cache check
  const cacheKey = `${key}:${productId}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  // Stripe check
  const stripeKey = getStripeKey();
  if (!stripeKey) {
    // No Stripe key configured — treat all keys as valid (dev mode)
    const devResult: BillingResult = {
      valid: true,
      tier: "premium",
      reason: "STRIPE_LIVE_KEY not set — running in dev mode, all keys accepted.",
    };
    setCache(cacheKey, devResult);
    return devResult;
  }

  // Circuit breaker: if Stripe has been failing, don't hammer it
  if (Date.now() < stripeCircuitOpenUntil) {
    return {
      valid: false,
      tier: "free",
      reason: "Billing service temporarily unavailable. Please try again shortly.",
    };
  }

  try {
    const result = await verifyKeyWithStripe(key, productId, stripeKey);
    stripeFailCount = 0; // Reset on success
    setCache(cacheKey, result);
    return result;
  } catch (err) {
    stripeFailCount++;
    if (stripeFailCount >= CIRCUIT_BREAKER_THRESHOLD) {
      stripeCircuitOpenUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
      stripeFailCount = 0;
    }
    // SECURITY: Log only the error type, not the full message (may contain sensitive data)
    const errType = err instanceof Error ? err.constructor.name : "UnknownError";
    process.stderr.write(`[billing] Stripe validation failed (${errType}). Circuit: ${stripeFailCount}/${CIRCUIT_BREAKER_THRESHOLD}\n`);

    // Fail CLOSED — deny premium access when we can't verify
    return {
      valid: false,
      tier: "free",
      reason: "Billing validation temporarily unavailable. Free tier access granted. Try again shortly.",
    };
  }
}

/**
 * Generate a new API key string (utility for key provisioning flows).
 * Uses crypto.randomBytes for 256-bit entropy.
 */
export function generateApiKey(): string {
  return API_KEY_PREFIX + randomBytes(16).toString("hex");
}

export { KEY_PURCHASE_URL, KEY_HELP_TEXT };
