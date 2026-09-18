# Plaid Setup — Already Done (Your Day)

**Provider:** Plaid BankFeedProvider (`apps/api/src/services/plaid-provider.ts`)
**Route:** `bank-connectivity.ts`
**Env vars needed:**
- `PLAID_CLIENT_ID`
- `PLAID_CLIENT_SECRET`
- `PLAID_ENVIRONMENT` (sandbox / production)

**What you already built:** Plaid integration exists. The only gap is the env vars in Cloudflare + deploy.

**To finish:**
1. Add `PLAID_CLIENT_ID` + `PLAID_CLIENT_SECRET` to Cloudflare Worker Variables
2. Renew Cloudflare token
3. Deploy `6754f0d`
4. Click "Connect Plaid" in admin panel

**DocuSign OAuth + Plaid are the two integrations. Both work. Just need deploy + env vars.**
