// /api/cron/appointment-reminders
//
// Windows Task Scheduler / external cron hits this every 10-15 min.
// Runs all three appointment reminder windows (24h/12h/4h) per call.
//
// AUTH: CRON_SECRET Authorization: Bearer <secret> — same pattern as
// the reservation-reminders route. In dev (no secret set), allows
// unauthenticated calls so localhost curl works for testing.
//
// SCHEDULER CONFIG (Windows Task Scheduler, every 15 min):
//   schtasks /create /tn "iTap Appointment Reminders" /tr ^
//     "powershell -Command \"Invoke-WebRequest -Method POST -Uri https://itap.zashx.com/api/cron/appointment-reminders -Headers @{Authorization='Bearer YOUR_SECRET'}\"" ^
//     /sc minute /mo 15 /ru SYSTEM
//
// Query params:
//   ?dryRun=1                  — don't actually send SMS
//   ?window=24h|12h|4h         — only run one window (debug)

import { NextRequest, NextResponse } from "next/server";
import {
  runAppointmentReminders,
  type ReminderWindow,
} from "@/lib/reminders/appointment-service";

function checkAuth(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // dev fallback
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
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const onlyWindow = url.searchParams.get("window") as ReminderWindow | null;

  const windows: ReminderWindow[] = onlyWindow ? [onlyWindow] : ["24h", "12h", "4h"];
  const results: Record<string, any> = { dryRun };
  for (const w of windows) {
    try {
      results[w] = await runAppointmentReminders(w, { dryRun });
    } catch (err: any) {
      console.error(`[cron/appointment-reminders] ${w} failed:`, err);
      results[w] = { error: err?.message || "unknown" };
    }
  }
  return NextResponse.json({ success: true, results });
}
