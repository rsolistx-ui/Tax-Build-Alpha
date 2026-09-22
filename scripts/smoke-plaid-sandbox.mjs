// Validates the real Plaid Sandbox credential + Transactions Sync contract.
// It intentionally logs only counts/status, never credentials, access tokens,
// public tokens, or transaction details.
const clientId = process.env.PLAID_CLIENT_ID;
const secret = process.env.PLAID_CLIENT_SECRET;
if (!clientId || !secret) {
  console.error("PLAID_CLIENT_ID and PLAID_CLIENT_SECRET must be set in this shell. No request was made.");
  process.exit(1);
}

async function plaid(path, body) {
  const response = await fetch(`https://sandbox.plaid.com${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: clientId, secret, ...body }),
  });
  if (!response.ok) throw new Error(`Plaid Sandbox ${path} failed with HTTP ${response.status}`);
  return response.json();
}

let accessToken;
try {
  const token = await plaid("/sandbox/public_token/create", {
    institution_id: "ins_109508",
    initial_products: ["transactions"],
    options: { override_username: "user_transactions_dynamic", override_password: "pass_good" },
  });
  const exchanged = await plaid("/item/public_token/exchange", { public_token: token.public_token });
  accessToken = exchanged.access_token;
  const sync = await plaid("/transactions/sync", { access_token: accessToken, options: { count: 10 } });
  console.log(`Plaid Sandbox passed: Transactions Sync returned ${Array.isArray(sync.added) ? sync.added.length : 0} initial item(s).`);
} finally {
  if (accessToken) {
    try { await plaid("/item/remove", { access_token: accessToken }); }
    catch { console.error("Plaid Sandbox cleanup could not remove the temporary test item."); }
  }
}
