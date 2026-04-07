/**
 * Simple in-memory rate limiter for free-tier MCP tool access.
 *
 * Tracks calls per session ID (or "anonymous" fallback) with configurable
 * per-tool limits. Designed to be generous — free tier should be useful,
 * not crippled.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface RateLimitConfig {
  /** Max calls allowed in the window. Default: 30. */
  maxCalls: number;
  /** Window duration in milliseconds. Default: 1 hour. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Total limit for this window. */
  limit: number;
  /** Unix ms when the window resets. */
  resetsAt: number;
  /** Seconds until reset (convenience). */
  retryAfterSeconds: number;
}

interface WindowEntry {
  /** Timestamps of calls within the current window. */
  timestamps: number[];
  /** Start of the current window. */
  windowStart: number;
}

// ── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: RateLimitConfig = {
  maxCalls: 30,
  windowMs: 60 * 60 * 1000, // 1 hour
};

/** Preset configs for common use cases. */
export const RATE_LIMITS = {
  /** Standard free-tier limit: 30 calls/hour. */
  standard: { maxCalls: 30, windowMs: 60 * 60 * 1000 } as RateLimitConfig,
  /** Generous limit for read-only tools: 100 calls/hour. */
  readOnly: { maxCalls: 100, windowMs: 60 * 60 * 1000 } as RateLimitConfig,
  /** Tight limit for expensive operations: 5 calls/hour. */
  expensive: { maxCalls: 5, windowMs: 60 * 60 * 1000 } as RateLimitConfig,
  /** Burst-friendly: 10 calls per minute. */
  burst: { maxCalls: 10, windowMs: 60 * 1000 } as RateLimitConfig,
} as const;

// ── Rate Limiter ─────────────────────────────────────────────────────────────

/**
 * Key: `${sessionId}:${toolName}`
 * Bounded to MAX_WINDOWS entries to prevent memory exhaustion from session spoofing.
 */
const MAX_WINDOWS = 50_000;
const windows = new Map<string, WindowEntry>();

/**
 * Prune expired windows periodically to prevent memory leaks.
 * Runs every 5 minutes.
 */
let pruneTimer: ReturnType<typeof setInterval> | null = null;

function ensurePruner(): void {
  if (pruneTimer) return;
  pruneTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of windows) {
      if (now - entry.windowStart > (DEFAULT_CONFIG.windowMs * 2)) {
        windows.delete(key);
      }
    }
  }, 5 * 60 * 1000);
  // Don't keep the process alive just for pruning
  if (pruneTimer && typeof pruneTimer === "object" && "unref" in pruneTimer) {
    pruneTimer.unref();
  }
}

/** Evict oldest entries if we're over the size limit. */
function evictIfNeeded(): void {
  if (windows.size < MAX_WINDOWS) return;
  // Remove oldest 10% of entries
  const toRemove = Math.ceil(MAX_WINDOWS * 0.1);
  let removed = 0;
  for (const key of windows.keys()) {
    if (removed >= toRemove) break;
    windows.delete(key);
    removed++;
  }
}

/**
 * Check (and consume) a rate limit slot.
 *
 * @param sessionId  Identifier for the caller — session ID, IP, or "anonymous".
 * @param toolName   The tool being called.
 * @param config     Rate limit configuration (defaults to standard).
 * @returns          Whether the call is allowed and remaining quota info.
 */
export function checkRateLimit(
  sessionId: string,
  toolName: string,
  config: RateLimitConfig = DEFAULT_CONFIG,
): RateLimitResult {
  ensurePruner();
  evictIfNeeded();

  const key = `${sessionId || "anonymous"}:${toolName}`;
  const now = Date.now();

  let entry = windows.get(key);

  // Start a new window if none exists or current window expired
  if (!entry || now - entry.windowStart >= config.windowMs) {
    entry = { timestamps: [], windowStart: now };
    windows.set(key, entry);
  }

  // Prune timestamps outside the sliding window
  const windowStart = now - config.windowMs;
  entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

  const resetsAt = entry.windowStart + config.windowMs;
  const retryAfterSeconds = Math.max(0, Math.ceil((resetsAt - now) / 1000));

  if (entry.timestamps.length >= config.maxCalls) {
    return {
      allowed: false,
      remaining: 0,
      limit: config.maxCalls,
      resetsAt,
      retryAfterSeconds,
    };
  }

  // Consume a slot
  entry.timestamps.push(now);

  return {
    allowed: true,
    remaining: config.maxCalls - entry.timestamps.length,
    limit: config.maxCalls,
    resetsAt,
    retryAfterSeconds,
  };
}

/**
 * Peek at current rate limit status without consuming a slot.
 */
export function peekRateLimit(
  sessionId: string,
  toolName: string,
  config: RateLimitConfig = DEFAULT_CONFIG,
): RateLimitResult {
  ensurePruner();
  const key = `${sessionId || "anonymous"}:${toolName}`;
  const now = Date.now();
  const entry = windows.get(key);

  if (!entry || now - entry.windowStart >= config.windowMs) {
    return {
      allowed: true,
      remaining: config.maxCalls,
      limit: config.maxCalls,
      resetsAt: now + config.windowMs,
      retryAfterSeconds: Math.ceil(config.windowMs / 1000),
    };
  }

  const windowStart = now - config.windowMs;
  const activeCalls = entry.timestamps.filter((t) => t > windowStart).length;
  const remaining = Math.max(0, config.maxCalls - activeCalls);
  const resetsAt = entry.windowStart + config.windowMs;

  return {
    allowed: remaining > 0,
    remaining,
    limit: config.maxCalls,
    resetsAt,
    retryAfterSeconds: Math.max(0, Math.ceil((resetsAt - now) / 1000)),
  };
}

/** Clear all rate limit state (for testing). */
export function clearRateLimits(): void {
  windows.clear();
}
