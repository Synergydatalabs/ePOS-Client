// =============================================================================
// Telegram notify — shared bot channel for payment events.
//
// Reuses the same env vars zashx-app uses for its master-payin notifier
// so a single ZashxNotifyBot channel receives both IBAN payins (zashx)
// and Stripe supplier-invoice payments (tap-app hub):
//
//   TELEGRAM_NOTIFY_BOT_TOKEN
//   TELEGRAM_NOTIFY_CHAT_ID
//
// Fire-and-forget: never throws — a failed notify must not poison the
// payment path. All errors log to console and return false.
// =============================================================================

function escapeHtml(s: string): string {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatMoney(amountCents: number, currency: string): string {
  const amount = (amountCents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const symbol =
    currency === "USD" ? "$" :
    currency === "CAD" ? "CA$" :
    currency === "GBP" ? "£" :
    currency === "EUR" ? "€" :
    currency === "INR" ? "₹" : "";
  return `${symbol}${amount} ${currency}`;
}

/**
 * Low-level Telegram sendMessage. Kept small on purpose — no retries,
 * no queue. Payment-notification traffic is trivially low volume; if
 * Telegram is down we log and move on.
 */
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
 * Notify the ops channel that a new supplier invoice was just created.
 * Fires from the invoice-create route (one-off) and from the daily
 * subscription cron (recurring generation).
 *
 * Message shape (kept short by request — no customer name/email yet):
 *   📄 New invoice created
 *   Invoice: INV-2026-0024
 *   Amount:  CA$ 99.00 CAD
 *   Type:    Subscription (Monthly)   ← or "One-time"
 */
export async function notifyInvoiceCreated(params: {
  invoiceNumber: string;
  amountCents: number;
  currency: string;
  subscription: { interval: "MONTHLY" | "ANNUAL" | string; sequence: number } | null;
}): Promise<boolean> {
  const botToken = process.env.TELEGRAM_NOTIFY_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_NOTIFY_CHAT_ID;
  if (!botToken || !chatId) return false;

  let typeLine: string;
  if (params.subscription) {
    const iv =
      params.subscription.interval === "MONTHLY"
        ? "Monthly"
        : params.subscription.interval === "ANNUAL"
        ? "Annual"
        : params.subscription.interval;
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
  return sendTelegramMessage(botToken, chatId, lines.join("\n"), "HTML");
}

/**
 * Notify the ops channel that a supplier invoice was just paid.
 * Kept short by request:
 *   "You've just received a payment through {processor}."
 *   Invoice: INV-2026-0023
 *   Amount:  CA$ 99.00 CAD
 *
 * No Stripe/Moneris internal references, no processor IDs — clean money
 * message for the team channel.
 */
export async function notifyInvoicePaid(params: {
  invoiceNumber: string;
  amountCents: number;
  currency: string;
  processor?: "Stripe" | "Moneris" | "Mock" | string;
}): Promise<boolean> {
  const botToken = process.env.TELEGRAM_NOTIFY_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_NOTIFY_CHAT_ID;
  if (!botToken || !chatId) {
    // Silent when env not set — dev machines commonly won't have it and
    // that shouldn't spam warnings on every mock-pay call.
    return false;
  }
  const processor = params.processor || "Stripe";
  const lines = [
    `💰 You've just received a payment through <b>${escapeHtml(processor)}</b>.`,
    ``,
    `<b>Invoice:</b> <code>${escapeHtml(params.invoiceNumber)}</code>`,
    `<b>Amount:</b> ${escapeHtml(formatMoney(params.amountCents, params.currency))}`,
  ];
  return sendTelegramMessage(botToken, chatId, lines.join("\n"), "HTML");
}
