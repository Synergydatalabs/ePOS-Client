// POST /api/webhooks/payment/moneris — STUB
//
// Moneris integration comes after GP. Until it does, this endpoint exists
// so URL configuration in the Moneris admin console can be validated (they
// often ping the URL with a test event during setup) without silently
// 404-ing.
//
// When Moneris ships, replace with a real handler using the same shape as
// the GP webhook — different signature header, different body parser, same
// downstream call to markPoAsPaid().

import { NextRequest, NextResponse } from "next/server";

export async function POST(_request: NextRequest) {
  console.warn(
    "[WEBHOOK-MONERIS] Moneris webhook received but integration not implemented yet"
  );
  return NextResponse.json(
    {
      error: "Moneris webhook processing is not implemented yet",
      hint: "This endpoint exists so URL config can be validated. Full integration lands with the Moneris release.",
    },
    { status: 501 }
  );
}
