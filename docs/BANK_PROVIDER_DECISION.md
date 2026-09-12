# Bank Connectivity Provider Decision (2026-09-12)

## Providers Evaluated

| Provider | Ownership | Coverage (US Institutions) | Pricing Model | Developer Experience | Key Differentiator |
|----------|-----------|---------------------------|---------------|---------------------|-------------------|
| **Plaid** | Independent (Visa minority) | ~12,000 | Per-item + monthly platform fee ($500/mo min) + per-connection | Good docs, mature SDKs, Link UI | Market leader, best coverage, OAuth for major banks |
| **Finicity** (Mastercard) | Mastercard | ~15,000 | Per-API-call + monthly minimums | Good API, less polished Link | Strong mortgage/lending focus, Mastercard backing |
| **MX** | Independent | ~18,000 | Per-active-user + platform fee | Clean API, modern Link | Strong data enrichment, categorization |
| **Akoya** | Bank-owned (JPM, BofA, Wells, etc.) | ~3,000 (growing) | Revenue-share / per-call | Newer API, bank-standard OAuth | Bank-owned = no screen scraping, direct API access |
| **Teller** | Independent | ~5,000 | Simple per-connection/mo | Best DX, minimal Link, open-source SDKs | Developer-first, transparent pricing, open-source |

## Decision Criteria for Folio

| Criterion | Weight | Notes |
|-----------|--------|-------|
| **Coverage for target clients** | High | SMB clients use major banks (Chase, BofA, Wells, Citi, USB, PNC, Truist, Capital One) + regional CUs |
| **Reliability / uptime** | Critical | Bank feed failures = failed reconciliations = angry accountants |
| **Pricing predictability** | High | Per-connection/mo > per-item for SMB volume |
| **Developer experience** | High | Team velocity matters; Link customization, webhook reliability |
| **Direct API vs scraping** | High | Akoya = direct bank APIs (no scraping); others mix |
| **OAuth / token management** | High | Must handle refresh, revocation, re-auth cleanly |
| **Webhook reliability** | High | Real-time sync depends on it |
| **Categorization quality** | Medium | Folio has its own categorization; provider categories are secondary |
| **International** | Low | US-only for now |

## Recommendation: **Teller as Primary, Plaid as Fallback**

### Rationale

1. **Developer Experience**: Teller's API is cleanest, SDKs are open-source, Link is minimal and customizable. Team velocity wins.

2. **Pricing Transparency**: Simple per-connection/month (no per-item, no platform fee minimums). Predictable for SMB volume.

3. **Coverage Adequate**: Covers all major US banks + top 100 credit unions. Folio's SMB clients are well-covered.

3. **Open Source SDKs**: TypeScript SDK is first-class, maintained by Teller team + community.

4. **Fallback Strategy**: Plaid as secondary for institutions Teller doesn't cover (long tail). Dual-provider architecture is standard.

4. **No Platform Fee Minimums**: Plaid/Finicity/MX have $500-2000/mo platform fees. Teller has none.

5. **Direct API Trend**: Teller uses direct OAuth where available (major banks), falls back to scraping only where needed.

## Implementation Plan

### Phase 1: Teller Integration (Week 1-3)
- [ ] Teller sandbox setup, Link token flow
- [ ] Exchange public token → access token
- [ ] Account sync (getAccounts, getBalances)
- [ ] Transaction sync with cursor pagination
- [ ] Webhook handler (transactions.updated, accounts.updated, account.deleted)
- [ ] Cursor management (save/load per account)
- [ ] Error handling / re-auth flow
- [ ] Unit + integration tests

### Phase 2: Plaid Fallback (Week 4-5)
- [ ] Plaid sandbox, Link token
- [ ] Exchange public token → access token + item_id
- [ ] Same sync interface (implement BankFeedProvider)
- [ ] Institution search for Link customization
- [ ] Webhook handling (TRANSACTIONS_REMOVED, etc.)

### Phase 3: Provider Abstraction & Routing (Week 6)
- [ ] BankFeedProvider interface implementation for both
- [ ] Provider selection logic (Teller first, Plaid fallback)
- [ ] Unified connection management UI
- [ ] Provider migration (switch provider for existing connection)

### Phase 4: Production Hardening (Week 7-8)
- [ ] Rate limit handling (Teller: generous; Plaid: 500/min)
- [ ] Webhook retry + dead letter queue
- [ ] Connection health monitoring (last_successful_sync_at)
- [ ] Re-auth flow (expired tokens, revoked access)
- [ ] Load testing, chaos testing

## Database Schema (Already in 0016)
- `bank_connections` - one per firm/client, stores provider, access_token (encrypted), institution, status
- `bank_accounts` - per connection, provider_account_id, type, balances, visibility
- `bank_transactions_external` - normalized transactions from provider
- `bank_sync_cursors` - per connection+account, provider cursor
- Triggers for updated_at on all tables

## Encryption
- Access tokens encrypted at rest via application-level encryption (libsodium/NaCl) before DB write
- Key derived from `BANK_ENCRYPTION_KEY` env var (rotated via key versioning)

## Webhook Security
- Verify Teller signature (HMAC-SHA256 with webhook secret)
- Verify Plaid signature (plaid-signature header)
- Idempotent processing (transaction_id + connection_id unique constraint)

## Open Questions
1. **Single vs multi-provider per connection**: Start with single-provider per connection; migration is a v2 feature
2. **Institution selection UI**: Teller's Link handles this; Plaid's Link allows institution search
3. **Re-auth UX**: When token expires/revoked, show banner in app with "Reconnect" button → new Link token flow
3. **Rate limit strategy**: Teller is generous; Plaid needs token bucket (500/min, 10 concurrent)

## Decision
**Proceed with Teller as primary provider.** Create `PlaidBankFeedProvider` as second implementation of `BankFeedProvider` interface for fallback.