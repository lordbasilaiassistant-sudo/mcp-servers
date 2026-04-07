import {
  generateApiKey,
  storeApiKey,
  revokeAllCustomerKeys,
  type ApiKeyRecord,
  type CustomerRecord,
} from "./keys";
import {
  sendKeyDeliveryEmail,
  sendPaymentFailedEmail,
  sendCancellationEmail,
} from "./email";

// ---------------------------------------------------------------------------
// Types for Stripe webhook payloads (subset — only what we need)
// ---------------------------------------------------------------------------

interface StripeCheckoutSession {
  id: string;
  customer: string;
  customer_email: string | null;
  customer_details?: { email: string };
  metadata?: Record<string, string>;
  subscription?: string;
  mode: "payment" | "subscription" | "setup";
}

interface StripeInvoice {
  id: string;
  customer: string;
  customer_email: string | null;
  subscription: string | null;
  status: string;
  attempt_count: number;
}

interface StripeSubscription {
  id: string;
  customer: string;
  status: string;
}

interface StripeEvent {
  id: string;
  type: string;
  data: {
    object: StripeCheckoutSession | StripeInvoice | StripeSubscription;
  };
}

export interface WebhookEnv {
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_LIVE_KEY: string;
  RESEND_API_KEY: string;
  API_KEYS: KVNamespace;
  CUSTOMERS: KVNamespace;
}

// ---------------------------------------------------------------------------
// Stripe webhook signature verification (Web Crypto, no SDK)
// ---------------------------------------------------------------------------

const TIMESTAMP_TOLERANCE_SECONDS = 300; // 5 minutes

export async function verifyStripeSignature(
  payload: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const parts = signature.split(",");
  const timestampPart = parts.find((p) => p.startsWith("t="));
  const sigPart = parts.find((p) => p.startsWith("v1="));

  if (!timestampPart || !sigPart) return false;

  const timestamp = timestampPart.slice(2);
  const expectedSig = sigPart.slice(3);

  // Reject stale timestamps
  const age = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
  if (isNaN(age) || Math.abs(age) > TIMESTAMP_TOLERANCE_SECONDS) return false;

  // Compute HMAC-SHA256
  const signedPayload = `${timestamp}.${payload}`;
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(signedPayload));
  const computedSig = hexEncode(new Uint8Array(mac));

  return timingSafeEqual(computedSig, expectedSig);
}

function hexEncode(bytes: Uint8Array): string {
  const hex: string[] = [];
  for (const b of bytes) {
    hex.push(b.toString(16).padStart(2, "0"));
  }
  return hex.join("");
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

async function handleCheckoutCompleted(
  session: StripeCheckoutSession,
  env: WebhookEnv,
): Promise<Response> {
  // Prefer Stripe-verified email sources over user-controllable metadata
  const email =
    session.customer_email ??
    session.customer_details?.email;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    console.error("Invalid or missing email on checkout session");
    return new Response("Invalid email on session", { status: 400 });
  }

  const customerId = session.customer;

  // Validate product_ids from metadata — must be prod_ prefixed Stripe IDs
  const rawProductIds = session.metadata?.product_ids?.split(",") ?? [];
  const productIds = rawProductIds
    .filter((id: string) => /^prod_[A-Za-z0-9]+$/.test(id.trim()))
    .map((id: string) => id.trim());
  if (productIds.length === 0) productIds.push("contract-scanner");

  // Validate tier — must be one of the allowed values
  const allowedTiers = ["pro", "usage", "bundle"] as const;
  const rawTier = session.metadata?.tier ?? "pro";
  const tier: ApiKeyRecord["tier"] = allowedTiers.includes(rawTier as any) ? rawTier as ApiKeyRecord["tier"] : "pro";

  const apiKey = generateApiKey();

  const record: ApiKeyRecord = {
    key: apiKey,
    customerId,
    productIds,
    tier,
    active: true,
    createdAt: new Date().toISOString(),
    expiresAt: null,
    checkoutSessionId: session.id,
  };

  const { created, record: finalRecord } = await storeApiKey(
    env.API_KEYS,
    env.CUSTOMERS,
    record,
    email,
  );

  if (!created) {
    // Idempotent — already processed this session
    return jsonResponse({ ok: true, duplicate: true });
  }

  // Store tier in Stripe customer metadata (NOT the API key — keys only live in KV)
  await updateStripeCustomerMetadata(env.STRIPE_LIVE_KEY, customerId, {
    thryx_has_key: "true",
    thryx_tier: tier,
  }).catch((err) => console.error("Failed to update Stripe metadata"));

  // Send delivery email
  await sendKeyDeliveryEmail(
    { RESEND_API_KEY: env.RESEND_API_KEY },
    email,
    finalRecord.key,
    productIds,
  ).catch((err) => console.error("Failed to send delivery email:", err));

  return jsonResponse({ ok: true, created: true });
}

async function handleInvoicePaid(
  invoice: StripeInvoice,
  env: WebhookEnv,
): Promise<Response> {
  // Verify customer exists
  const customer = await env.CUSTOMERS.get<CustomerRecord>(
    `customer:${invoice.customer}`,
    "json",
  );

  if (!customer) {
    // First invoice for a checkout-created customer may arrive before checkout webhook.
    // That's OK — checkout handler is the source of truth for key creation.
    return jsonResponse({ ok: true, note: "customer_not_found_yet" });
  }

  // Subscription renewals — ensure keys remain active
  for (const key of customer.apiKeys) {
    const record = await env.API_KEYS.get<ApiKeyRecord>(`key:${key}`, "json");
    if (record && !record.active) {
      record.active = true;
      await env.API_KEYS.put(`key:${key}`, JSON.stringify(record));
    }
  }

  return jsonResponse({ ok: true });
}

async function handleInvoicePaymentFailed(
  invoice: StripeInvoice,
  env: WebhookEnv,
): Promise<Response> {
  const customer = await env.CUSTOMERS.get<CustomerRecord>(
    `customer:${invoice.customer}`,
    "json",
  );

  if (!customer) {
    return jsonResponse({ ok: true, note: "customer_not_found" });
  }

  // Grace period: only deactivate after multiple failures (attempt_count >= 3 ~ 3+ days)
  if (invoice.attempt_count >= 3) {
    for (const key of customer.apiKeys) {
      const record = await env.API_KEYS.get<ApiKeyRecord>(`key:${key}`, "json");
      if (record && record.active) {
        record.active = false;
        await env.API_KEYS.put(`key:${key}`, JSON.stringify(record));
      }
    }
  }

  // Send warning email
  if (customer.email) {
    await sendPaymentFailedEmail(
      { RESEND_API_KEY: env.RESEND_API_KEY },
      customer.email,
    ).catch((err) => console.error("Failed to send payment failed email:", err));
  }

  return jsonResponse({ ok: true, deactivated: invoice.attempt_count >= 3 });
}

async function handleSubscriptionDeleted(
  subscription: StripeSubscription,
  env: WebhookEnv,
): Promise<Response> {
  const customerId = subscription.customer;

  const revoked = await revokeAllCustomerKeys(
    env.API_KEYS,
    env.CUSTOMERS,
    customerId,
  );

  // Send cancellation email
  const customer = await env.CUSTOMERS.get<CustomerRecord>(
    `customer:${customerId}`,
    "json",
  );

  if (customer?.email) {
    await sendCancellationEmail(
      { RESEND_API_KEY: env.RESEND_API_KEY },
      customer.email,
    ).catch((err) => console.error("Failed to send cancellation email:", err));
  }

  return jsonResponse({ ok: true, keysRevoked: revoked });
}

// ---------------------------------------------------------------------------
// Main webhook dispatcher
// ---------------------------------------------------------------------------

export async function handleStripeWebhook(
  request: Request,
  env: WebhookEnv,
): Promise<Response> {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing stripe-signature header", { status: 400 });
  }

  const payload = await request.text();

  const valid = await verifyStripeSignature(
    payload,
    signature,
    env.STRIPE_WEBHOOK_SECRET,
  );

  if (!valid) {
    return new Response("Invalid signature", { status: 401 });
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(payload) as StripeEvent;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed":
      return handleCheckoutCompleted(
        event.data.object as StripeCheckoutSession,
        env,
      );

    case "invoice.paid":
      return handleInvoicePaid(event.data.object as StripeInvoice, env);

    case "invoice.payment_failed":
      return handleInvoicePaymentFailed(
        event.data.object as StripeInvoice,
        env,
      );

    case "customer.subscription.deleted":
      return handleSubscriptionDeleted(
        event.data.object as StripeSubscription,
        env,
      );

    default:
      // Acknowledge unknown events to prevent Stripe retries
      return jsonResponse({ ok: true, ignored: event.type });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Update Stripe customer metadata via the API.
 */
async function updateStripeCustomerMetadata(
  apiKey: string,
  customerId: string,
  metadata: Record<string, string>,
): Promise<void> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(metadata)) {
    params.append(`metadata[${k}]`, v);
  }

  const response = await fetch(
    `https://api.stripe.com/v1/customers/${customerId}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Stripe API error ${response.status}: ${text}`);
  }
}
