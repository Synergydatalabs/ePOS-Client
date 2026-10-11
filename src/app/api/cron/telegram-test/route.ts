// GET /api/cron/telegram-test?token=$CRON_SECRET
//
// One-shot Telegram health check. Sends a canned message to one of
// our bot channels using the same helper the paid-invoice path uses.
// Response echoes bot/chat availability + send success so you can
// diagnose "no message received" without tailing logs.
//
// Query params:
//   token    (required) — CRON_SECRET
//   channel  (optional) — "default" (default) or "kakao"
//
// Examples:
//   /api/cron/telegram-test?token=XYZ               → default bot
//   /api/cron/telegram-test?token=XYZ&channel=kakao → Kakao bot
//
// Guarded by CRON_SECRET. Safe to hit repeatedly — one Telegram msg.

import { NextRequest, NextResponse } from "next/server";
import { notifyInvoicePaid } from "@/lib/telegram-notify";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const expected = process.env.CRON_SECRET;
  if (!expected || token !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const channel = (request.nextUrl.searchParams.get("channel") || "default").toLowerCase();
  const isKakao = channel === "kakao";

  // Which env vars does this channel's bot need?
  const botVar = isKakao ? "TELEGRAM_KAKAO_BOT_TOKEN" : "TELEGRAM_NOTIFY_BOT_TOKEN";
  const chatVar = isKakao ? "TELEGRAM_KAKAO_CHAT_ID" : "TELEGRAM_NOTIFY_CHAT_ID";
  const hasBot = Boolean(process.env[botVar]);
  const hasChat = Boolean(process.env[chatVar]);

  if (!hasBot || !hasChat) {
    return NextResponse.json({
      ok: false,
      channel,
      hasBotToken: hasBot,
      hasChatId: hasChat,
      hint: `Set ${botVar} and ${chatVar} in .env, then pm2 restart.`,
    });
  }

  // method="kakao_pay" routes through botForMethod() to the Kakao bot;
  // omitting it (or any non-Kakao string) routes to the default bot.
  const sent = await notifyInvoicePaid({
    invoiceNumber: isKakao ? "TEST-KAKAO-0001" : "TEST-0001",
    amountCents: isKakao ? 300000 : 100,     // ₩3,000 or $1.00
    currency: isKakao ? "KRW" : "CAD",
    processor: isKakao ? "Paddle" : "Test",
    method: isKakao ? "kakao_pay" : undefined,
    transactionId: isKakao ? "txn_test_123" : null,
    customerEmail: isKakao ? "buyer@example.co.kr" : null,
    paidAt: new Date(),
  });

  return NextResponse.json({
    ok: sent,
    channel,
    hasBotToken: hasBot,
    hasChatId: hasChat,
    sentAt: new Date().toISOString(),
    hint: sent
      ? isKakao
        ? "Check the KakaoBOT group — a ₩3,000 KRW test KakaoPay payment should have arrived."
        : "Check the default channel — a $1.00 CAD test message should have arrived."
      : "sendMessage failed. Check the server console for the Telegram API response.",
  });
}
