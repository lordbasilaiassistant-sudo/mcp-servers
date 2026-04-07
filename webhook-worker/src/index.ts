import { handleStripeWebhook, type WebhookEnv } from "./stripe";
import { validateKey } from "./keys";

export interface Env extends WebhookEnv {
  ENVIRONMENT: string;
  /** Shared secret for MCP servers to call /api/validate-key */
  VALIDATE_KEY_SECRET: string;
}

// Simple in-memory rate limiter for validate-key endpoint
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 30; // 30 requests per minute per IP
const RATE_LIMIT_WINDOW_MS = 60_000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT_MAX;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // --- CORS preflight ---
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(env) });
    }

    // --- Route: POST /webhook/stripe ---
    if (request.method === "POST" && url.pathname === "/webhook/stripe") {
      try {
        return await handleStripeWebhook(request, env);
      } catch (err) {
        console.error("Webhook handler error:", err);
        return jsonResponse({ error: "internal_error" }, 500, env);
      }
    }

    // --- Route: POST /api/validate-key (auth required, POST only) ---
    if (request.method === "POST" && url.pathname === "/api/validate-key") {
      // Rate limit by IP
      const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
      if (!checkRateLimit(ip)) {
        return jsonResponse({ error: "rate_limited", retryAfterSeconds: 60 }, 429, env);
      }

      // Require shared secret authentication
      const authHeader = request.headers.get("authorization");
      const expectedAuth = `Bearer ${env.VALIDATE_KEY_SECRET}`;
      if (!authHeader || !timingSafeCompare(authHeader, expectedAuth)) {
        return jsonResponse({ error: "unauthorized" }, 401, env);
      }

      let body: { key?: string; product?: string };
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ error: "invalid_json" }, 400, env);
      }

      const { key, product } = body;
      if (!key || !product) {
        return jsonResponse(
          { error: "missing_params", suggestion: "Provide key and product in request body" },
          400,
          env,
        );
      }

      // Input validation
      if (key.length > 100 || product.length > 100) {
        return jsonResponse({ error: "invalid_input" }, 400, env);
      }

      try {
        const result = await validateKey(env.API_KEYS, key, product);
        // Return minimal information — only valid/invalid and tier
        return jsonResponse(
          { valid: result.valid, tier: result.valid ? result.tier : undefined },
          result.valid ? 200 : 403,
          env,
        );
      } catch (err) {
        console.error("Key validation error");
        return jsonResponse({ error: "internal_error" }, 500, env);
      }
    }

    // --- Route: GET /health ---
    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse({
        status: "ok",
        timestamp: new Date().toISOString(),
      }, 200, env);
    }

    // --- 404 ---
    return jsonResponse({ error: "not_found" }, 404, env);
  },
} satisfies ExportedHandler<Env>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(data: Record<string, unknown>, status = 200, env?: Env): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
      ...corsHeaders(env),
    },
  });
}

function corsHeaders(env?: Env): Record<string, string> {
  // Restrict CORS to known origins. Webhook endpoint doesn't need CORS at all.
  // Only the validate-key endpoint needs it, and it should be server-to-server.
  return {
    "Access-Control-Allow-Origin": env?.ENVIRONMENT === "development" ? "*" : "https://thryx.fun",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, stripe-signature",
  };
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  let result = 0;
  for (let i = 0; i < bufA.length; i++) {
    result |= bufA[i] ^ bufB[i];
  }
  return result === 0;
}
