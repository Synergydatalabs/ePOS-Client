// Build a QuickBooks JournalEntry payload for a single business day at
// a tenant. Aggregates all paid orders across the day into one entry so
// QBO isn't cluttered with hundreds of individual sale rows.
//
// Accounting layout for a typical retail/restaurant day:
//
//   Debits (cash coming IN):
//     Cash Account       — sum of cash-tender revenue
//     Card Account       — sum of card-tender revenue (net of surcharges)
//     Discounts Account  — total discounts (contra-revenue, so debit)
//     Refunds Account    — refund payouts (contra-revenue, debit)
//
//   Credits (revenue + liabilities generated):
//     Sales Account      — subtotal (post-discount)
//     Tax Liability      — tax collected (net of refunded tax)
//     Tips Liability     — tips passed through (owe employees)
//
// Debits and credits must balance exactly — QBO rejects unbalanced JEs.
// We round every line to whole cents (QBO uses decimals but we work in
// integer cents) and the builder emits a rounding-plug line if the
// sums differ by any residual cent.

import prisma from "./prisma";

export interface DailyJournalInput {
  connectionId: string;
  businessDate: Date; // YYYY-MM-DD (start of local day)
  locationId?: string; // if unset, aggregates across all tenant locations
}

export interface JournalLine {
  memo: string;
  amountCents: number;
  side: "Debit" | "Credit";
  accountRef?: string; // QBO account Id
}

export interface BuiltJournal {
  entry: any; // ready for QBO POST
  lines: JournalLine[]; // human view
  totals: {
    grossSales: number;
    tax: number;
    tips: number;
    discounts: number;
    refunds: number;
    refundedTax: number;
    surcharges: number;
    cashReceived: number;
    cardReceived: number;
  };
  warnings: string[];
}

export async function buildDailyJournal(
  input: DailyJournalInput
): Promise<BuiltJournal> {
  const { connectionId, businessDate, locationId } = input;

  const conn = await prisma.integrationConnection.findUnique({
    where: { id: connectionId },
  });
  if (!conn) throw new Error("Integration not found");

  const dayStart = new Date(
    Date.UTC(
      businessDate.getUTCFullYear(),
      businessDate.getUTCMonth(),
      businessDate.getUTCDate()
    )
  );
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  // Aggregate all paid orders in the window. Split payments across
  // methods so the debit side can hit the right cash vs card accounts.
  const orders = await prisma.order.findMany({
    where: {
      location: { tenantId: conn.tenantId },
      createdAt: { gte: dayStart, lt: dayEnd },
      status: { not: "CANCELLED" },
      paymentStatus: { in: ["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"] },
      ...(locationId ? { locationId } : {}),
    },
    select: {
      id: true,
      subtotal: true,
      discountAmount: true,
      taxAmount: true,
      tax2Amount: true,
      tipAmount: true,
      surchargeAmount: true,
      total: true,
      payments: {
        select: {
          method: true,
          provider: true,
          amount: true,
          status: true,
          refunds: {
            where: { status: { notIn: ["FAILED", "CANCELLED"] } },
            select: { amount: true },
          },
        },
      },
    },
  });

  let grossSales = 0;
  let tax = 0;
  let tips = 0;
  let discounts = 0;
  let refunds = 0;
  let refundedTax = 0;
  let surcharges = 0;
  let cashReceived = 0;
  let cardReceived = 0;

  const isCashLike = (m?: string | null) =>
    !!m && ["cash", "gift_card"].includes(m.toLowerCase());

  for (const o of orders) {
    grossSales += Math.max(0, o.subtotal - o.discountAmount);
    tax += o.taxAmount + (o.tax2Amount || 0);
    tips += o.tipAmount;
    discounts += o.discountAmount;
    surcharges += o.surchargeAmount || 0;

    for (const p of o.payments) {
      if (p.status !== "COMPLETED") continue;
      const method = (p.method || p.provider || "").toLowerCase();
      if (isCashLike(method)) {
        cashReceived += p.amount;
      } else {
        cardReceived += p.amount;
      }
      const refunded = p.refunds.reduce((s, r) => s + r.amount, 0);
      if (refunded > 0) {
        refunds += refunded;
        // Prorate the tax portion of the refund
        const refundShare = o.total > 0 ? Math.min(1, refunded / o.total) : 0;
        refundedTax += Math.round(o.taxAmount * refundShare);
      }
    }
  }

  const netTax = Math.max(0, tax - refundedTax);
  const netCashReceived = cashReceived - Math.min(cashReceived, refunds);
  const netCardReceived = cardReceived; // card refunds go back to card

  // ── Build human-readable line list ───────────────────────────────
  const lines: JournalLine[] = [];
  const warnings: string[] = [];

  const push = (
    side: "Debit" | "Credit",
    amountCents: number,
    memo: string,
    accountRef?: string
  ) => {
    if (amountCents <= 0) return;
    if (!accountRef) warnings.push(`Missing account mapping for ${memo}`);
    lines.push({ side, amountCents, memo, accountRef });
  };

  // Debits (money in / contra-revenue)
  push("Debit", netCashReceived, "Cash sales received", conn.cashAccountRef || undefined);
  push("Debit", netCardReceived, "Card sales received", conn.cardAccountRef || undefined);
  push("Debit", discounts, "Discounts given", conn.discountsAccountRef || undefined);
  push("Debit", refunds, "Refunds paid out", conn.refundsAccountRef || undefined);

  // Credits (revenue + liabilities)
  push("Credit", grossSales, "Gross sales (net of discount)", conn.salesAccountRef || undefined);
  push("Credit", netTax, "Sales tax collected (net of refunded)", conn.taxLiabilityRef || undefined);
  push("Credit", tips, "Tips owed to employees", conn.tipsLiabilityRef || undefined);
  push("Credit", surcharges, "Card processing surcharges", conn.salesAccountRef || undefined);

  // Balancing plug — if debits ≠ credits by a rounding cent, add a
  // one-cent adjustment to the smaller side. Warn if the gap is > $1.
  const debitTotal = lines
    .filter((l) => l.side === "Debit")
    .reduce((s, l) => s + l.amountCents, 0);
  const creditTotal = lines
    .filter((l) => l.side === "Credit")
    .reduce((s, l) => s + l.amountCents, 0);
  const diff = debitTotal - creditTotal;
  if (Math.abs(diff) > 100) {
    warnings.push(
      `Journal is unbalanced by ${(diff / 100).toFixed(
        2
      )} — check payment split. Payload will still POST but QBO may reject.`
    );
  } else if (diff !== 0) {
    if (diff > 0) {
      // more debits — credit-side plug
      push(
        "Credit",
        diff,
        "Rounding adjustment",
        conn.salesAccountRef || undefined
      );
    } else {
      push(
        "Debit",
        -diff,
        "Rounding adjustment",
        conn.discountsAccountRef || undefined
      );
    }
  }

  // ── Build QBO-shaped JournalEntry payload ────────────────────────
  const txnDate = businessDate.toISOString().slice(0, 10);
  const entry = {
    TxnDate: txnDate,
    PrivateNote: `Daily sales summary for ${txnDate} from iTAP POS`,
    Line: lines.map((l) => ({
      DetailType: "JournalEntryLineDetail",
      Amount: Number((l.amountCents / 100).toFixed(2)),
      Description: l.memo,
      JournalEntryLineDetail: {
        PostingType: l.side,
        ...(l.accountRef
          ? { AccountRef: { value: l.accountRef } }
          : {}),
      },
    })),
  };

  return {
    entry,
    lines,
    totals: {
      grossSales,
      tax,
      tips,
      discounts,
      refunds,
      refundedTax,
      surcharges,
      cashReceived,
      cardReceived,
    },
    warnings,
  };
}
