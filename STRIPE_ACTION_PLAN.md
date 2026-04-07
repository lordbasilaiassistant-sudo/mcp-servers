# Stripe Account Action Plan — MCP Server Monetization

**Date:** 2026-03-09
**Status:** READ-ONLY ANALYSIS — No changes executed yet
**Existing sales:** 0 (clean slate, no customer impact from archiving)

---

## 1. Product Cleanup Plan

### KEEP (2 products — repurpose for MCP lineup)

| Product ID | Current Name | Repurpose To | Current Price |
|---|---|---|---|
| `prod_U6ZXt3RcHILRqX` | Solidity Security Scanner | **contract-scanner-mcp-server** (keep as-is, perfect fit) | $39 one-time |
| `prod_U6Z0Ci7PlXpSD3` | Base DeFi MCP Suite — 10 Servers, 60+ Tools | **defi-orchestrator-mcp-server** (rename, re-price) | $99 one-time |

### CREATE (2 new products needed)

| New Product | Description | Notes |
|---|---|---|
| **multi-wallet-mcp-server** | Agent treasury & multi-wallet management for Base/EVM | Could also be called "agent-treasury-mcp-server" |
| **gas-paymaster-mcp-server** | Sponsored gas for AI agents via The Agent Cafe paymaster | Novel product, no existing match |

### ARCHIVE (22 products — everything else)

| Product ID | Name | Reason |
|---|---|---|
| `prod_U6ZWjG6k4AstG1` | MCP PostgreSQL Query Server | Not in MCP lineup |
| `prod_U6ZTck6y6YTvl3` | MCP GitHub Project Manager | Not in MCP lineup |
| `prod_U6ZTo4qZcFiXx3` | MCP Supabase Tools | Not in MCP lineup |
| `prod_U6ZLJj0Ny0dc2W` | Foundry ERC-20 Factory | Not in MCP lineup |
| `prod_U6ZGFtQRE6QsBT` | MCP Stripe Analytics Server | Not in MCP lineup |
| `prod_U6Lc9Ba0lMWtu9` | Claude Code Skill Pack | Template product |
| `prod_U6LckBvVPERZxr` | DeFi Dashboard Template | Template product |
| `prod_U6LczOvSndyyj4` | AI Agent Automation Pack | Template product |
| `prod_U6LcKz0JNj8IUe` | Token Launch Blueprint | Template product |
| `prod_U6Lcf4UTlm0eqj` | MCP Server Starter Kit | Template product |
| `prod_U40TPndWJUE6ot` | InvoiceForge Pro Pack | Business template |
| `prod_U40RkAVTssI1Nh` | ContractKit Pro Pack | Business template |
| `prod_U40R0EeP6kYIm3` | InvoiceForge Pro Pack (dup) | Business template duplicate |
| `prod_U40R46q7WHjHE0` | ContractKit Pro Pack (dup) | Business template duplicate |
| `prod_U40O4UQamQFRPK` | Financial Command Center Pro | Business template |
| `prod_U40Ku2jIiQ7obz` | ReadyResume Pro | Business template |
| `prod_U40KkQYTDFgzun` | EmailCraft Pro | Business template |
| `prod_U3zXuTNffRB2D0` | Complete Business Bundle | Business template |
| `prod_U3zXtJSLf0kBMp` | Pitch Deck & Business Plan Toolkit | Business template |
| `prod_U3zXOT931GNrAR` | SaaS Starter Kit | Business template |
| `prod_U3zXlPxtMynadp` | The SOP Vault | Business template |
| `prod_U3zX152SXlpjCB` | Startup Financial Command Center | Business template |
| `prod_U3zXG5TcBrCC8O` | Agency Launch Kit | Business template |

**Execution steps:**
1. Deactivate all 36 payment links (all are currently active)
2. Archive all 28 prices on the 22 products being removed
3. Archive the 22 products
4. Update metadata on the 2 kept products

---

## 2. Pricing Strategy

### Target market reality
- Buyers are AI agent developers and Claude Code / Cursor users
- They're evaluating tools in seconds, not minutes
- Subscriptions make sense because MCP servers need ongoing maintenance, updates, and API access
- Competitor landscape: most MCP servers are free/open-source, paid ones are $5-20/mo

### Recommended pricing per product

#### contract-scanner-mcp-server (Solidity Security Scanner)
- **Free tier:** 5 scans/day, basic vulnerability detection (reentrancy, overflow, access control)
- **Pro tier: $9/mo** — Unlimited scans, advanced patterns (flash loan vectors, MEV exposure, gas optimization), CI/CD integration, priority updates
- **One-time option:** $39 (current price) for self-hosted perpetual license (no API, just the code)
- **Rationale:** $9/mo is impulse-buy territory for any dev deploying contracts. The one-time $39 serves as an upsell for teams who want to own it.

#### multi-wallet-mcp-server (Agent Treasury)
- **Free tier:** 2 wallets, read-only operations (balance checks, tx history)
- **Pro tier: $12/mo** — Unlimited wallets, full write operations (send, swap), encrypted key storage, multi-chain support
- **Rationale:** Wallet management is mission-critical for agents. Slightly higher price signals reliability. Subscription justified by ongoing key management and chain support.

#### gas-paymaster-mcp-server (Sponsored Gas)
- **Free tier:** 100 sponsored txs/month, Base mainnet only
- **Pro tier: $15/mo** — 5,000 sponsored txs/month, multi-chain, priority gas estimation, webhook notifications on low balance
- **Usage tier: $29/mo** — Unlimited sponsored txs, dedicated paymaster contract, custom policies
- **Rationale:** This is infrastructure — agents need gas continuously. Higher price justified by the real cost of gas sponsorship overhead. Three tiers capture hobbyists through production agents.

#### defi-orchestrator-mcp-server (DeFi Suite)
- **Free tier:** Read-only (pool data, price feeds, portfolio view)
- **Pro tier: $19/mo** — Full DeFi operations (swap, LP, bridge), strategy automation, 10+ protocol integrations
- **Rationale:** Most comprehensive server, highest value. $19/mo is still under the "don't think twice" threshold for any serious DeFi dev/agent operator. Rename from "Base DeFi MCP Suite" to focus on orchestration.

#### Bundle: All 4 MCP Servers
- **Pro Bundle: $39/mo** (save 22% vs individual)
- **Rationale:** Clean number, under $40/mo psychological barrier. Incentivizes full ecosystem adoption.

### Price architecture in Stripe
For each product, create TWO prices:
1. `recurring/month` — the subscription price
2. `one_time` — lifetime/self-hosted license at ~4x monthly (for contract-scanner and defi-orchestrator only)

---

## 3. Webhook Architecture Plan

### Flow: Customer Pays -> API Key Delivery

```
Customer clicks Payment Link
        |
        v
Stripe Checkout completes
        |
        v
Stripe fires `checkout.session.completed` webhook
        |
        v
Webhook endpoint (Cloudflare Worker or Vercel Edge Function)
        |
        v
  1. Validate webhook signature (STRIPE_WEBHOOK_SECRET)
  2. Extract: customer_email, product_id, price_id, subscription_id
  3. Generate API key: `mcp_live_<uuid>` + `mcp_test_<uuid>`
  4. Store in KV/DB: { api_key, customer_id, product_id, tier, rate_limits, created_at }
  5. Send delivery email via Resend/SendGrid:
     - API key
     - Installation instructions (npx @thryx/{server} --key=mcp_live_xxx)
     - Link to docs
  6. Return 200 to Stripe
```

### Subscription lifecycle webhooks

| Event | Action |
|---|---|
| `checkout.session.completed` | Generate API key, send welcome email |
| `invoice.paid` | Extend access, reset monthly quotas |
| `invoice.payment_failed` | Send warning email, downgrade to free tier after 3 days |
| `customer.subscription.deleted` | Revoke API key, downgrade to free tier |
| `customer.subscription.updated` | Update tier/rate limits in KV store |

### API Key validation (in each MCP server)
```
On tool call:
  1. Check X-API-Key header (or --key CLI arg)
  2. If no key -> free tier (rate-limited)
  3. If key -> validate against KV store (Cloudflare Workers KV or Upstash Redis)
  4. Check tier + rate limits
  5. Execute or reject
```

### Recommended hosting for webhook endpoint
- **Primary: Cloudflare Worker** — zero cold start, free tier covers 100k req/day, Workers KV for key storage
- **Why not Vercel:** Cold starts on edge functions, more complex deployment
- **Why not self-hosted:** Defeats "minimal hosting burden" goal
- **Estimated setup time:** 2-3 hours for the Worker + KV schema

### KV Schema
```
Key: mcp_key:{api_key}
Value: {
  customer_id: "cus_xxx",
  product_ids: ["prod_xxx"],
  tier: "pro",
  rate_limits: { scans_per_day: -1, wallets: -1 },
  subscription_id: "sub_xxx",
  created_at: "2026-03-09T00:00:00Z",
  expires_at: null
}

Key: customer:{customer_id}
Value: {
  email: "user@example.com",
  api_keys: ["mcp_live_xxx"],
  subscriptions: ["sub_xxx"]
}
```

---

## 4. Payment Link Strategy

### DELETE (deactivate) — ALL 36 existing payment links
Every single existing payment link is tied to the old product/pricing structure (one-time payments for templates and misc MCP servers). None are reusable because:
- All are one-time pricing (we're moving to subscriptions)
- Most point to products being archived
- Payment links can't be edited after creation — only deactivated

### CREATE — New payment links needed

| Payment Link | Product | Price | Type |
|---|---|---|---|
| Contract Scanner Pro | contract-scanner-mcp-server | $9/mo | Subscription |
| Contract Scanner Lifetime | contract-scanner-mcp-server | $39 | One-time |
| Agent Treasury Pro | multi-wallet-mcp-server | $12/mo | Subscription |
| Gas Paymaster Pro | gas-paymaster-mcp-server | $15/mo | Subscription |
| Gas Paymaster Usage | gas-paymaster-mcp-server | $29/mo | Subscription |
| DeFi Orchestrator Pro | defi-orchestrator-mcp-server | $19/mo | Subscription |
| DeFi Orchestrator Lifetime | defi-orchestrator-mcp-server | $79 | One-time |
| Full MCP Bundle | All 4 servers | $39/mo | Subscription |

**Total: 8 new payment links**

Each payment link should:
- Enable `customer_creation: "always"` (so we get customer objects for key management)
- Set `after_completion` to redirect to a "Getting Started" page (not just hosted confirmation)
- Enable `allow_promotion_codes: true` for launch discounts
- Include `metadata` with `{ product_slug: "contract-scanner", tier: "pro" }` for webhook routing

---

## 5. Execution Order (when ready)

1. **Phase 1 — Cleanup** (5 min)
   - Deactivate all 36 payment links
   - Archive all prices on products being removed
   - Archive 22 products

2. **Phase 2 — Product Setup** (10 min)
   - Update `prod_U6ZXt3RcHILRqX` metadata (contract-scanner)
   - Update `prod_U6Z0Ci7PlXpSD3` name + metadata (defi-orchestrator)
   - Create `multi-wallet-mcp-server` product
   - Create `gas-paymaster-mcp-server` product
   - Create subscription prices on all 4 products
   - Create one-time prices where applicable

3. **Phase 3 — Payment Links** (5 min)
   - Create 8 new payment links

4. **Phase 4 — Webhook Infra** (2-3 hours)
   - Deploy Cloudflare Worker for webhook endpoint
   - Set up Workers KV for API key storage
   - Register webhook URL in Stripe dashboard
   - Test with Stripe CLI: `stripe trigger checkout.session.completed`

5. **Phase 5 — Integration** (1-2 hours)
   - Add API key validation middleware to each MCP server
   - Add rate limiting logic per tier
   - Test end-to-end: payment -> key generation -> server access
