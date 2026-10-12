// =============================================================================
// POST /api/admin/telegram/replay
//
// 2026-10-11: one-off endpoint to re-fire Telegram notifications for recent
// paid invoices. Useful after setting up a new bot/chat to backfill the
// group with historical data for parser testing.
//
// Routes each invoice via the standard notifyInvoicePaid helper, which
// sends KakaoPay payments to the Kakao bot and everything else to the
// default bot. So after calling this once:
//   - KakaoBOT group fills up with the KakaoPay history
//   - Default group fills up with Stripe/Helcim/Moneris history
//
// Gated by CRON_SECRET so a random visitor can't spam your groups.
// Call with: ?limit=20&since=7 (last 20 paid invoices from last 7 days).
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { notifyInvoicePaid, notifyKakaoTotal } from "@/lib/telegram-notify";

export async function POST(request: NextRequest) {
  // Auth: shared secret (same one used by scheduled cron hits).
  const secret = process.env.CRON_SECRET;
  const incoming =
    request.headers.get("x-cron-secret") ||
    request.nextUrl.searchParams.get("secret");
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not set on the server" },
      { status: 503 }
    );
  }
  if (incoming !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limitRaw = Number(request.nextUrl.searchParams.get("limit") || "20");
  const limit = Math.max(1, Math.min(100, Number.isFinite(limitRaw) ? limitRaw : 20));
  const sinceDays = Math.max(
    1,
    Math.min(365, Number(request.nextUrl.searchParams.get("since") || "7"))
  );
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

  const invoices = await prisma.supplierInvoice.findMany({
    where: {
      paymentStatus: "PAID",
      paidAt: { gte: since },
    },
    orderBy: { paidAt: "desc" },
    take: limit,
    select: {
      id: true,
      invoiceNumber: true,
      totalCents: true,
      amountPaidCents: true,
      currency: true,
      paidMethod: true,
      paidAt: true,
      paymentLinkRef: true,
      customerEmail: true,
    },
  });

  const results: Array<{
    invoice: string;
    method: string | null;
    routed: "kakao" | "default";
    ok: boolean;
    kakoTotalFired?: boolean;
  }> = [];

  // 2026-10-12: KakoTotal replay — accumulate running total per currency
  // chronologically (oldest first) so the final message in the KakoTotal
  // group shows the correct cumulative total, matching what would appear
  // if these payments had come in via live webhook. Iterate oldest-first
  // for this reason.
  const chronological = [...invoices].sort((a, b) =>
    (a.paidAt?.getTime() ?? 0) - (b.paidAt?.getTime() ?? 0)
  );
  const runningByCurrency = new Map<string, number>();

  for (const inv of chronological) {
    const method = (inv.paidMethod || "").toLowerCase();
    // Flatten "paddle_kakao_pay" → "kakao_pay" so routing matches.
    const normalisedMethod = method
      .replace(/^paddle_/, "")
      .replace(/^helcim_/, "")
      .replace(/^stripe_/, "");

    const routed =
      normalisedMethod === "kakao_pay" ||
      normalisedMethod === "kakaopay" ||
      method.includes("kakao")
        ? "kakao"
        : "default";

    const processor = method.startsWith("paddle_")
      ? "Paddle"
      : method.startsWith("helcim")
        ? "Helcim"
        : method.startsWith("stripe") || method === "card" || method === "upi"
          ? "Stripe"
          : method.startsWith("moneris")
            ? "Moneris"
            : "Processor";

    const amount = inv.amountPaidCents ?? inv.totalCents;

    const ok = await notifyInvoicePaid({
      invoiceNumber: inv.invoiceNumber,
      amountCents: amount,
      currency: inv.currency,
      processor,
      method: normalisedMethod,
      transactionId: inv.paymentLinkRef,
      customerEmail: inv.customerEmail,
      paidAt: inv.paidAt,
    });

    // 2026-10-12: for Kakao payments ALSO fire the KakoTotal running-total
    // notification so the dedicated balance-tracking group gets backfilled
    // in sync with the per-payment group.
    let kakoTotalFired = false;
    if (routed === "kakao") {
      const prevTotal = runningByCurrency.get(inv.currency) ?? 0;
      const newTotal = prevTotal + amount;
      runningByCurrency.set(inv.currency, newTotal);
      kakoTotalFired = await notifyKakaoTotal({
        kind: "payment",
        amountCents: amount,
        currency: inv.currency,
        runningTotalCents: newTotal,
        invoiceNumber: inv.invoiceNumber,
        transactionId: inv.paymentLinkRef,
        occurredAt: inv.paidAt,
      });
      // Second message in the same tick — honour the rate limit.
      await new Promise((r) => setTimeout(r, 150));
    }

    results.push({
      invoice: inv.invoiceNumber,
      method: inv.paidMethod,
      routed,
      ok,
      kakoTotalFired,
    });

    // Small delay to stay well under Telegram's 30 msg/sec rate limit.
    await new Promise((r) => setTimeout(r, 150));
  }

  const summary = {
    checked: invoices.length,
    sent: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    byRouting: {
      kakao: results.filter((r) => r.routed === "kakao").length,
      default: results.filter((r) => r.routed === "default").length,
    },
    results,
  };

  return NextResponse.json(summary);
}

export async function GET() {
  return NextResponse.json(
    {
      error: "Method not allowed",
      hint: "POST ?secret=<CRON_SECRET>&limit=20&since=7 to replay the last 20 paid invoices from the last 7 days.",
    },
    { status: 405 }
  );
}
