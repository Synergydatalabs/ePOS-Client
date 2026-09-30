// GET /api/cron/telegram-test?token=$CRON_SECRET
//
// One-shot Telegram health check. Sends a canned message to the
// TELEGRAM_NOTIFY_CHAT_ID channel using the same helper the paid-invoice
// path uses. Response echoes bot/chat availability + send success so
// you can diagnose "no message received" without tailing logs.
//
// Guarded by CRON_SECRET (same secret the subscriptions cron uses).
// Safe to hit repeatedly — no side effects beyond one Telegram message.

import { NextRequest, NextResponse } from "next/server";
import { notifyInvoicePaid } from "@/lib/telegram-notify";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const expected = process.env.CRON_SECRET;
  if (!expected || token !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const hasBot = Boolean(process.env.TELEGRAM_NOTIFY_BOT_TOKEN);
  const hasChat = Boolean(process.env.TELEGRAM_NOTIFY_CHAT_ID);
  if (!hasBot || !hasChat) {
    return NextResponse.json({
      ok: false,
      hasBotToken: hasBot,
      hasChatId: hasChat,
      hint: "Set TELEGRAM_NOTIFY_BOT_TOKEN and TELEGRAM_NOTIFY_CHAT_ID in the environment, then pm2 restart.",
    });
  }

  const sent = await notifyInvoicePaid({
    invoiceNumber: "TEST-0001",
    amountCents: 100,
    currency: "CAD",
    processor: "Test",
  });

  return NextResponse.json({
    ok: sent,
    hasBotToken: hasBot,
    hasChatId: hasChat,
    sentAt: new Date().toISOString(),
    hint: sent
      ? "Check the Telegram channel — a $1.00 CAD test message should have arrived."
      : "sendMessage failed. Check the server console for the Telegram API response.",
  });
}
