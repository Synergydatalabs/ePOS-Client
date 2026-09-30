// ============================================================================
// GET /api/tenants/[tenantId]/menu/template
//
// Returns a starter CSV with the correct headers + 2 example rows.
// Browser downloads it via Content-Disposition: attachment.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import { generateMenuCsvTemplate } from "@/lib/csv/menu-import";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await params;

  // Even template download requires admin auth — don't leak that the tenant
  // exists to unauthenticated users.
  const auth = await validateRequest(request, tenantId, "POS_ADMIN");
  if (!auth.success) return auth.response;

  const csv = generateMenuCsvTemplate();

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition":
        'attachment; filename="menu-template.csv"',
      "Cache-Control": "no-store",
    },
  });
}
