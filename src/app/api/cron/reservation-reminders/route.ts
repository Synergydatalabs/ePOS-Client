// ============================================================================
// /api/cron/reservation-reminders
//
// Called by an external scheduler (Windows Task Scheduler, GitHub Actions
// cron, cron-job.org, etc.) every 10–15 minutes. Each call:
//   1. Runs the 24-hour window
//   2. Runs the 2-hour window
//   3. Returns a JSON report of what fired
//
// SECURITY:
//   Authenticated via CRON_SECRET header — set a long random string in env
//   and configure the scheduler to send `Authorization: Bearer <secret>`.
//   In dev (no CRON_SECRET set), allows unauthenticated calls so you can
//   curl it from localhost for testing.
//
// SCHEDULER CONFIG (Windows Task Scheduler example, every 15 min):
//   schtasks /create /tn "iTap Reservation Reminders" /tr ^
//     "powershell -Command \"Invoke-WebRequest -Method POST -Uri https://itap.zashx.com/api/cron/reservation-reminders -Headers @{Authorization='Bearer YOUR_SECRET'}\"" ^
//     /sc minute /mo 15 /ru SYSTEM
//
// Returns 200 even if some sends fail (so the scheduler doesn't keep
// retrying the whole batch). Failures are reported in `result.failed`
// and individual rows of `result.detail`.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { runReservationReminders } from "@/lib/reminders/service";

function checkAuth(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // No secret configured — dev mode, allow.
    return true;
  }
  const header = request.headers.get("authorization") || "";
  const provided = header.replace(/^Bearer\s+/i, "");
  return provided === secret;
}

export async function POST(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  // Optional ?dryRun=1 query param — useful when first wiring up the
  // scheduler to confirm the right rows would be picked without spamming
  // guests with reminders.
  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";

  // Optional ?window=24h|2h to run only one window — helps when debugging.
  const onlyWindow = new URL(request.url).searchParams.get("window") as
    | "24h" | "2h" | null;

  try {
    const results: any = { dryRun };

    if (!onlyWindow || onlyWindow === "24h") {
      results.window24h = await runReservationReminders("24h", { dryRun });
    }
    if (!onlyWindow || onlyWindow === "2h") {
      results.window2h = await runReservationReminders("2h", { dryRun });
    }

    return NextResponse.json({ success: true, ...results, ranAt: new Date().toISOString() });
  } catch (err: any) {
    console.error("[cron/reservation-reminders] fatal error:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Internal error" },
      { status: 500 }
    );
  }
}

// Also accept GET — some schedulers (cron-job.org free tier) only do GET.
export async function GET(request: NextRequest) {
  return POST(request);
}
