// GET /api/supplier/products/import/template
// Returns a CSV template file the supplier downloads, fills in, and re-uploads.
//
// Columns match the SupplierProduct model — same names the /import endpoint
// expects, so a round-trip through this template always parses cleanly.

import { NextRequest, NextResponse } from "next/server";
import { requireSupplierAuth } from "@/lib/supplier-auth";

// Column headers + one example row so a supplier who's never used the tool
// before immediately sees the expected shape. The example row is a plausible
// pizza-shop supply (mirrors the Andy's Pizza demo tenant's world) so it
// looks familiar to our first customer.
const TEMPLATE_ROWS: string[][] = [
  [
    "name",
    "sku",
    "category",
    "unit_label",
    "wholesale_price",
    "retail_price",
    "min_order_qty",
    "step_qty",
    "lead_time_days",
    "track_inventory",
    "stock_level",
    "low_stock_threshold",
    "description",
    "barcode",
    "is_public",
  ],
  [
    "Mozzarella Cheese 20kg Box",
    "MOZ-20KG",
    "Cheese",
    "box",
    "85.00",
    "120.00",
    "2",
    "1",
    "3",
    "true",
    "30",
    "5",
    "Whole milk mozzarella, aged 60 days",
    "1234567890123",
    "false",
  ],
];

function toCsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          // Only quote when necessary — cleaner-looking files. Cells that
          // contain a comma, quote, or newline get wrapped in quotes, with
          // inner quotes escaped by doubling.
          if (/[",\n\r]/.test(cell)) {
            return `"${cell.replace(/"/g, '""')}"`;
          }
          return cell;
        })
        .join(",")
    )
    .join("\r\n");
}

export async function GET(request: NextRequest) {
  const auth = await requireSupplierAuth(request);
  if (!auth.ok) return auth.response;

  const csv = toCsv(TEMPLATE_ROWS) + "\r\n";

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="supplier-products-template.csv"`,
    },
  });
}
