// =============================================================================
// Telegram notify — multi-channel bot notifier.
//
// 2026-10-11 refactor: route notifications to different bots/chats based on
// payment method. Two bots now:
//
//   DEFAULT (all tenants, all methods EXCEPT KakaoPay):
//     TELEGRAM_NOTIFY_BOT_TOKEN
//     TELEGRAM_NOTIFY_CHAT_ID
//
//   KAKAO (KakaoPay payments only, routed OUT of the default bot):
//     TELEGRAM_KAKAO_BOT_TOKEN
//     TELEGRAM_KAKAO_CHAT_ID
//
// Zero cross-contamination: a Kakao payment hits ONLY the Kakao bot;
// everything else hits ONLY the default bot.
//
// Fire-and-forget: never throws. All errors log + return false.
// =============================================================================

function escapeHtml(s: string): string {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// 2026-10-11: zero-decimal awareness for display. KRW/JPY/VND don't have
// a sub-unit, so our internal cents representation (×100) needs ÷100 for
// display. Everything else is cents → divide by 100 as usual.
const ZERO_DECIMAL = new Set([
  "KRW", "JPY", "VND", "CLP", "ISK", "UGX", "RWF", "XOF", "XAF",
  "PYG", "DJF", "GNF", "KMF", "MGA", "BIF", "XPF",
]);

function formatMoney(amountCents: number, currency: string): string {
  const upper = currency.toUpperCase();
  const native = ZERO_DECIMAL.has(upper)
    ? amountCents / 100   // internal cents (×100) → native whole units
    : amountCents / 100;  // standard sub-unit currencies also /100
  const amount = native.toLocaleString(undefined, {
    minimumFractionDigits: ZERO_DECIMAL.has(upper) ? 0 : 2,
    maximumFractionDigits: ZERO_DECIMAL.has(upper) ? 0 : 2,
  });
  const symbol =
    upper === "USD" ? "$" :
    upper === "CAD" ? "CA$" :
    upper === "GBP" ? "£" :
    upper === "EUR" ? "€" :
    upper === "INR" ? "₹" :
    upper === "KRW" ? "₩" :
    upper === "JPY" ? "¥" : "";
  return `${symbol}${amount} ${upper}`;
}

/**
 * Route a notification to the right bot based on payment method.
 * KakaoPay payments → dedicated Kakao bot; everything else → default bot.
 * Returns null if the chosen bot isn't configured (env vars missing).
 */
function botForMethod(
  method: string | undefined | null
): { token: string; chatId: string; label: "kakao" | "default" } | null {
  const m = String(method || "").toLowerCase();
  const isKakao =
    m === "kakao_pay" ||
    m === "kakaopay" ||
    m === "paddle_kakao_pay" ||
    m === "paddle_kakaopay";

  if (isKakao) {
    const t = process.env.TELEGRAM_KAKAO_BOT_TOKEN;
    const c = process.env.TELEGRAM_KAKAO_CHAT_ID;
    if (!t || !c) {
      console.warn("[telegram-notify] KakaoPay payment but TELEGRAM_KAKAO_* env vars missing");
      return null;
    }
    return { token: t, chatId: c, label: "kakao" };
  }

  const t = process.env.TELEGRAM_NOTIFY_BOT_TOKEN;
  const c = process.env.TELEGRAM_NOTIFY_CHAT_ID;
  if (!t || !c) return null;
  return { token: t, chatId: c, label: "default" };
}

async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
  parseMode: "HTML" | "MarkdownV2" | "Markdown" = "HTML"
): Promise<boolean> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: parseMode,
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[telegram-notify] ${res.status}: ${body.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err: any) {
    console.warn("[telegram-notify] network error:", err?.message || err);
    return false;
  }
}

/**
 * Invoice created notification. Always goes to the default bot — Kakao
 * group only cares about actual payment events, not invoice drafts.
 */
export async function notifyInvoiceCreated(params: {
  invoiceNumber: string;
  amountCents: number;
  currency: string;
  subscription: { interval: "MONTHLY" | "ANNUAL" | string; sequence: number } | null;
}): Promise<boolean> {
  const bot = botForMethod(null); // always default bot
  if (!bot) return false;

  let typeLine: string;
  if (params.subscription) {
    const iv =
      params.subscription.interval === "MONTHLY" ? "Monthly" :
      params.subscription.interval === "ANNUAL" ? "Annual" :
      params.subscription.interval;
    typeLine = `Subscription (${iv})${params.subscription.sequence > 1 ? ` · #${params.subscription.sequence}` : ""}`;
  } else {
    typeLine = "One-time";
  }

  const lines = [
    `📄 <b>New invoice created</b>`,
    ``,
    `<b>Invoice:</b> <code>${escapeHtml(params.invoiceNumber)}</code>`,
    `<b>Amount:</b> ${escapeHtml(formatMoney(params.amountCents, params.currency))}`,
    `<b>Type:</b> ${escapeHtml(typeLine)}`,
  ];
  return sendTelegramMessage(bot.token, bot.chatId, lines.join("\n"), "HTML");
}

/**
 * Payment paid notification. Routes by `method`:
 * - kakao_pay → dedicated Kakao bot with parse-friendly format
 * - anything else → default bot with the standard short message
 */
export async function notifyInvoicePaid(params: {
  invoiceNumber: string;
  amountCents: number;
  currency: string;
  processor?: "Stripe" | "Moneris" | "Mock" | "Paddle" | "Helcim" | string;
  method?: string;
  transactionId?: string | null;
  customerEmail?: string | null;
  paidAt?: Date | null;
}): Promise<boolean> {
  const bot = botForMethod(params.method);
  if (!bot) return false;

  // Kakao: fixed-position parse-friendly format so Korean dev's parser can
  // extract fields with simple regex / line splits.
  if (bot.label === "kakao") {
    const lines = [
      `✅ <b>KakaoPay payment received</b>`,
      ``,
      `Status: PAID`,
      `Amount: ${escapeHtml(formatMoney(params.amountCents, params.currency))}`,
      `Invoice: ${escapeHtml(params.invoiceNumber)}`,
      `Method: kakao_pay`,
      `Transaction: ${escapeHtml(params.transactionId || "n/a")}`,
      `Paid at: ${(params.paidAt || new Date()).toISOString()}`,
      ...(params.customerEmail ? [`Customer: ${escapeHtml(params.customerEmail)}`] : []),
    ];
    return sendTelegramMessage(bot.token, bot.chatId, lines.join("\n"), "HTML");
  }

  // Default (non-Kakao): existing short format.
  const processor = params.processor || "Stripe";
  const lines = [
    `💰 You've just received a payment through <b>${escapeHtml(processor)}</b>.`,
    ``,
    `<b>Invoice:</b> <code>${escapeHtml(params.invoiceNumber)}</code>`,
    `<b>Amount:</b> ${escapeHtml(formatMoney(params.amountCents, params.currency))}`,
  ];
  return sendTelegramMessage(bot.token, bot.chatId, lines.join("\n"), "HTML");
}

/**
 * Payment failed notification. Routes by method the same way.
 */
export async function notifyPaymentFailed(params: {
  invoiceNumber: string;
  amountCents: number;
  currency: string;
  method?: string;
  reason?: string | null;
  attemptedAt?: Date | null;
}): Promise<boolean> {
  const bot = botForMethod(params.method);
  if (!bot) return false;

  if (bot.label === "kakao") {
    const lines = [
      `❌ <b>KakaoPay payment failed</b>`,
      ``,
      `Status: FAILED`,
      `Amount: ${escapeHtml(formatMoney(params.amountCents, params.currency))}`,
      `Invoice: ${escapeHtml(params.invoiceNumber)}`,
      `Method: kakao_pay`,
      `Reason: ${escapeHtml(params.reason || "unknown")}`,
      `Attempted at: ${(params.attemptedAt || new Date()).toISOString()}`,
    ];
    return sendTelegramMessage(bot.token, bot.chatId, lines.join("\n"), "HTML");
  }

  const lines = [
    `⚠️ <b>Payment failed</b>`,
    ``,
    `<b>Invoice:</b> <code>${escapeHtml(params.invoiceNumber)}</code>`,
    `<b>Amount:</b> ${escapeHtml(formatMoney(params.amountCents, params.currency))}`,
    `<b>Reason:</b> ${escapeHtml(params.reason || "unknown")}`,
  ];
  return sendTelegramMessage(bot.token, bot.chatId, lines.join("\n"), "HTML");
}

/**
 * 2026-10-12: KakoTotal bot — tracks running Kakao payment totals and
 * Paddle payout (withdrawal) events in its own group. Separate from the
 * KakaoPay payment-event bot so you can mute transaction noise but still
 * see balance movements.
 */
export async function notifyKakaoTotal(params: {
  kind: "payment" | "payout";
  amountCents: number;
  currency: string;
  runningTotalCents?: number | null;
  invoiceNumber?: string | null;
  transactionId?: string | null;
  payoutStatus?: "created" | "paid" | null;
  payoutId?: string | null;
  occurredAt?: Date | null;
}): Promise<boolean> {
  const token = process.env.TELEGRAM_KAKAOTOTAL_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_KAKAOTOTAL_CHAT_ID;
  if (!token || !chatId) {
    console.warn("[telegram-notify] KakoTotal event but TELEGRAM_KAKAOTOTAL_* env vars missing");
    return false;
  }

  const when = (params.occurredAt || new Date()).toISOString();

  if (params.kind === "payment") {
    const lines = [
      `💰 <b>KakaoPay payment received</b>`,
      ``,
      `Amount: ${escapeHtml(formatMoney(params.amountCents, params.currency))}`,
      ...(params.invoiceNumber ? [`Invoice: ${escapeHtml(params.invoiceNumber)}`] : []),
      ...(params.transactionId ? [`Transaction: ${escapeHtml(params.transactionId)}`] : []),
      ...(params.runningTotalCents != null
        ? [``, `<b>Running total: ${escapeHtml(formatMoney(params.runningTotalCents, params.currency))}</b>`]
        : []),
      `At: ${when}`,
    ];
    return sendTelegramMessage(token, chatId, lines.join("\n"), "HTML");
  }

  // payout branch — withdrawal from Paddle balance
  const headline = params.payoutStatus === "paid"
    ? "🏦 <b>Payout completed</b>"
    : "🏦 <b>Payout initiated</b>";
  const lines = [
    headline,
    ``,
    `Amount withdrawn: ${escapeHtml(formatMoney(params.amountCents, params.currency))}`,
    ...(params.payoutId ? [`Payout: ${escapeHtml(params.payoutId)}`] : []),
    ...(params.runningTotalCents != null
      ? [``, `<b>Remaining balance: ${escapeHtml(formatMoney(params.runningTotalCents, params.currency))}</b>`]
      : []),
    `At: ${when}`,
  ];
  return sendTelegramMessage(token, chatId, lines.join("\n"), "HTML");
}

/**
 * Payment refunded notification. Routes by method.
 */
export async function notifyPaymentRefunded(params: {
  invoiceNumber: string;
  amountCents: number;
  currency: string;
  method?: string;
  refundedAt?: Date | null;
}): Promise<boolean> {
  const bot = botForMethod(params.method);
  if (!bot) return false;

  if (bot.label === "kakao") {
    const lines = [
      `↩️ <b>KakaoPay payment refunded</b>`,
      ``,
      `Status: REFUNDED`,
      `Amount: ${escapeHtml(formatMoney(params.amountCents, params.currency))}`,
      `Invoice: ${escapeHtml(params.invoiceNumber)}`,
      `Method: kakao_pay`,
      `Refunded at: ${(params.refundedAt || new Date()).toISOString()}`,
    ];
    return sendTelegramMessage(bot.token, bot.chatId, lines.join("\n"), "HTML");
  }

  const lines = [
    `↩️ <b>Payment refunded</b>`,
    ``,
    `<b>Invoice:</b> <code>${escapeHtml(params.invoiceNumber)}</code>`,
    `<b>Amount:</b> ${escapeHtml(formatMoney(params.amountCents, params.currency))}`,
  ];
  return sendTelegramMessage(bot.token, bot.chatId, lines.join("\n"), "HTML");
}
