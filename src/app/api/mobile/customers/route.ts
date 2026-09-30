// GET /api/mobile/customers?search=<query>
//
// Search "customers" for the picker. There's no first-class Customer
// model in this schema — customer info lives inline on the Order row
// (customerName/customerPhone/customerEmail) same as the web POS uses.
// So a "search" here is a distinct-by-phone view of past orders that
// match the query.
//
// Query behaviour:
//   • Empty search  → most-recent 20 distinct customers at this location.
//   • Non-empty     → case-insensitive substring match on name OR phone
//                     OR email. Digits-only search is treated as phone.
//   • Results are deduped by phone first (customers pay across many
//     visits with the same number). If no phone, fall back to name-only.
//
// Response: { customers: [{ name, phone, email, lastOrderAt, visitCount }] }

import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getMobileOrderContext } from "@/lib/mobile-order-context";

export const dynamic = "force-dynamic";

const MAX_RESULTS = 20;
// We fetch more than we return, so dedup + newest-first sorting still
// yields MAX_RESULTS actual distinct customers even when a person has
// many past orders.
const FETCH_LIMIT = 200;

export async function GET(request: NextRequest) {
  const ctx = await getMobileOrderContext(request);
  if (!ctx.ok) return ctx.response;

  const search = (request.nextUrl.searchParams.get("search") || "").trim();

  // Base filter: only rows in this location that actually have customer
  // info — we don't want to surface empty rows from anonymous POS orders.
  const baseWhere: Prisma.OrderWhereInput = {
    locationId: ctx.ctx.locationId,
    OR: [
      { customerName: { not: null } },
      { customerPhone: { not: null } },
      { customerEmail: { not: null } },
    ],
  };

  const searchFilter = search.length > 0 ? buildSearchFilter(search) : null;

  const where: Prisma.OrderWhereInput = searchFilter
    ? { AND: [baseWhere, searchFilter] }
    : baseWhere;

  const rows = await prisma.order.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: FETCH_LIMIT,
    select: {
      customerName: true,
      customerPhone: true,
      customerEmail: true,
      updatedAt: true,
    },
  });

  // Dedup by phone (or by "name|email" when no phone). Keep the most
  // recent occurrence (rows are already sorted DESC).
  const seen = new Map<
    string,
    {
      name: string | null;
      phone: string | null;
      email: string | null;
      lastOrderAt: Date;
      visitCount: number;
    }
  >();

  for (const r of rows) {
    const key =
      r.customerPhone?.trim() ||
      `${r.customerName?.trim() || ""}|${r.customerEmail?.trim() || ""}`;
    if (!key || key === "|") continue;
    const existing = seen.get(key);
    if (existing) {
      existing.visitCount += 1;
      // First row is newest → don't overwrite name/phone/email.
    } else {
      seen.set(key, {
        name: r.customerName,
        phone: r.customerPhone,
        email: r.customerEmail,
        lastOrderAt: r.updatedAt,
        visitCount: 1,
      });
    }
  }

  const customers = Array.from(seen.values())
    .sort((a, b) => b.lastOrderAt.getTime() - a.lastOrderAt.getTime())
    .slice(0, MAX_RESULTS)
    .map((c) => ({
      name: c.name,
      phone: c.phone,
      email: c.email,
      lastOrderAt: c.lastOrderAt.toISOString(),
      visitCount: c.visitCount,
    }));

  return NextResponse.json({ customers });
}

function buildSearchFilter(search: string): Prisma.OrderWhereInput {
  const digitsOnly = search.replace(/\D/g, "");
  // Digit-heavy query → prioritise phone, still allow other fields to
  // match (e.g. someone typing an ID that also lives in a name).
  const phoneClauses: Prisma.OrderWhereInput[] =
    digitsOnly.length >= 3
      ? [{ customerPhone: { contains: digitsOnly } }]
      : [];

  return {
    OR: [
      { customerName: { contains: search, mode: "insensitive" } },
      { customerEmail: { contains: search, mode: "insensitive" } },
      { customerPhone: { contains: search, mode: "insensitive" } },
      ...phoneClauses,
    ],
  };
}
