// GET /api/payments/dropin/accounts
// Diagnostic endpoint — calls GP's /ucp/accounts and returns the list of
// accounts bound to your App ID. Use this to find the right value for
// GP_DROPIN_ACCOUNT_NAME (or GP_DROPIN_ACCOUNT_ID) env var.

import { NextResponse } from "next/server";
import {
  getDropinAccessToken,
  getDropinConfig,
  GP_API_VERSION,
} from "@/lib/gp-dropin";

export async function GET() {
  // Always return 200 with diagnostic JSON — easier to read in PowerShell.
  const config = getDropinConfig();

  let tokenResp: any;
  try {
    tokenResp = await getDropinAccessToken({
      permissions: [],          // empty = omit perms = full default scope
      secondsToExpire: 300,
    });
  } catch (tokenErr: any) {
    return NextResponse.json({
      success: false,
      step: "access_token",
      error: tokenErr?.message || "Failed to get access token",
      env: config.env,
      app_id_present: !!config.appId,
      app_key_present: !!config.appKey,
    });
  }

  const accountsUrl = `${config.baseUrl}/ucp/accounts`;
  let res: Response;
  try {
    res = await fetch(accountsUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-GP-Version": GP_API_VERSION,
        Authorization: `Bearer ${tokenResp.token}`,
      },
    });
  } catch (netErr: any) {
    return NextResponse.json({
      success: false,
      step: "fetch_accounts",
      error: netErr?.message || "Network error calling /ucp/accounts",
      url: accountsUrl,
    });
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    return NextResponse.json({
      success: false,
      step: "gp_response",
      status: res.status,
      url: accountsUrl,
      gpResponse: data,
      hint:
        res.status === 403
          ? "App ID likely doesn't have permission to list accounts. Check GP developer portal under your App → Accounts to find the account name manually."
          : undefined,
    });
  }

    // Build a friendly summary so user can see at a glance which to use
    const accounts = (data.accounts || []).map((a: any) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      status: a.status,
      permissions: a.permissions,
      // Highlight transaction-capable accounts
      canProcessTransactions: Array.isArray(a.permissions)
        ? a.permissions.some((p: string) => p.startsWith("TRN_POST"))
        : false,
    }));

    // Prefer plain `transaction_processing` over special variants like
    // `_dcc` (Dynamic Currency Conversion), `_pos`, etc. — those are
    // niche features. Fall back to the first transactional account if no
    // plain one exists.
    const txAccounts = accounts.filter((a: any) => a.canProcessTransactions);
    const recommendedAccount =
      txAccounts.find((a: any) => a.name === "transaction_processing") ||
      txAccounts.find((a: any) => !a.name.includes("_")) ||
      txAccounts[0];

    return NextResponse.json({
      success: true,
      env: config.env,
      app_id: config.appId,
      currentlyConfigured: {
        GP_DROPIN_ACCOUNT_NAME: config.accountName || "(not set)",
        GP_DROPIN_ACCOUNT_ID: config.accountId || "(not set)",
      },
      accounts,
      recommended: recommendedAccount
        ? {
            envVarToSet: "GP_DROPIN_ACCOUNT_NAME",
            value: recommendedAccount.name,
            alsoTry: recommendedAccount.id,
            note: `Add this to your .env: GP_DROPIN_ACCOUNT_NAME=${recommendedAccount.name}`,
          }
        : {
            note: "No account with TRN_POST_* permissions found. The App ID may need additional permissions enabled by GP support.",
          },
    });
}
