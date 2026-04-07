export interface ApiKeyRecord {
  key: string;
  customerId: string;
  productIds: string[];
  tier: "pro" | "usage" | "bundle";
  active: boolean;
  createdAt: string;
  expiresAt: string | null;
  checkoutSessionId: string;
}

export interface CustomerRecord {
  email: string;
  customerId: string;
  apiKeys: string[];
  subscriptions: string[];
  createdAt: string;
}

/**
 * Generate a prefixed API key using crypto.randomUUID().
 */
export function generateApiKey(): string {
  const uuid = crypto.randomUUID().replace(/-/g, "");
  return `thryx_live_${uuid}`;
}

/**
 * Store a new API key record in KV.
 * Returns false if a key already exists for this checkout session (idempotency).
 */
export async function storeApiKey(
  apiKeysKv: KVNamespace,
  customersKv: KVNamespace,
  record: ApiKeyRecord,
  email: string,
): Promise<{ created: boolean; record: ApiKeyRecord }> {
  // Idempotency: check if we already processed this checkout session
  const sessionKey = `session:${record.checkoutSessionId}`;
  const existingKeyForSession = await apiKeysKv.get(sessionKey);
  if (existingKeyForSession) {
    const existingRecord = await apiKeysKv.get<ApiKeyRecord>(
      `key:${existingKeyForSession}`,
      "json",
    );
    if (existingRecord) {
      return { created: false, record: existingRecord };
    }
  }

  // Store the API key record
  await apiKeysKv.put(`key:${record.key}`, JSON.stringify(record));

  // Store session -> key mapping for idempotency
  await apiKeysKv.put(sessionKey, record.key);

  // Update customer record
  const customerKey = `customer:${record.customerId}`;
  const existing = await customersKv.get<CustomerRecord>(customerKey, "json");

  if (existing) {
    existing.apiKeys.push(record.key);
    await customersKv.put(customerKey, JSON.stringify(existing));
  } else {
    const customer: CustomerRecord = {
      email,
      customerId: record.customerId,
      apiKeys: [record.key],
      subscriptions: [],
      createdAt: new Date().toISOString(),
    };
    await customersKv.put(customerKey, JSON.stringify(customer));
  }

  // Store email -> customer mapping for lookups
  await customersKv.put(`email:${email}`, record.customerId);

  return { created: true, record };
}

/**
 * Validate an API key for a specific product.
 */
export async function validateKey(
  kv: KVNamespace,
  key: string,
  productId: string,
): Promise<{ valid: boolean; tier: string; reason?: string }> {
  const record = await kv.get<ApiKeyRecord>(`key:${key}`, "json");

  if (!record) {
    return { valid: false, tier: "", reason: "key_not_found" };
  }

  if (!record.active) {
    return { valid: false, tier: record.tier, reason: "key_inactive" };
  }

  if (record.expiresAt && new Date(record.expiresAt) < new Date()) {
    return { valid: false, tier: record.tier, reason: "key_expired" };
  }

  // Validate product ID format (must be prod_ prefixed Stripe ID)
  if (!productId || !/^prod_[A-Za-z0-9]+$/.test(productId)) {
    return { valid: false, tier: "", reason: "invalid_product_id" };
  }

  if (!record.productIds.includes(productId)) {
    return { valid: false, tier: record.tier, reason: "product_not_authorized" };
  }

  return { valid: true, tier: record.tier };
}

/**
 * Revoke an API key (set active = false).
 */
export async function revokeKey(kv: KVNamespace, key: string): Promise<boolean> {
  const record = await kv.get<ApiKeyRecord>(`key:${key}`, "json");
  if (!record) return false;

  record.active = false;
  await kv.put(`key:${key}`, JSON.stringify(record));
  return true;
}

/**
 * Revoke all keys for a customer.
 */
export async function revokeAllCustomerKeys(
  apiKeysKv: KVNamespace,
  customersKv: KVNamespace,
  customerId: string,
): Promise<number> {
  const customer = await customersKv.get<CustomerRecord>(
    `customer:${customerId}`,
    "json",
  );
  if (!customer) return 0;

  let revoked = 0;
  for (const key of customer.apiKeys) {
    const didRevoke = await revokeKey(apiKeysKv, key);
    if (didRevoke) revoked++;
  }
  return revoked;
}
