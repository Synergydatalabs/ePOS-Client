// SES notifications for support-chat activity from the tap-app side —
// fired when a merchant or supplier replies (or opens a new thread) so
// the support team gets an email even if no one is watching the admin UI.
//
// All sends are fire-and-forget: the caller wraps in try/catch and
// swallows failures. A dropped notification never blocks the message
// write, which is the important side effect.
//
// Recipient logic:
//   • SUPPORT_NOTIFY_EMAIL env var — always. This is the shared inbox
//     the support team monitors. Configured on EC2 alongside SES creds.
//   • Assigned admin (if any) — extra addressee so the owning operator
//     sees the message even if they're not on the shared inbox.

import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import prisma from "@/lib/prisma";

const ses = new SESClient({ region: process.env.AWS_REGION || "us-east-1" });
const FROM_EMAIL = process.env.SES_FROM_EMAIL || "noreply@zashx.com";
const SUPPORT_NOTIFY_EMAIL = process.env.SUPPORT_NOTIFY_EMAIL || "";
// Where clicking "View thread" takes the operator. Falls back to a
// sensible default so a missing env var doesn't ship a broken link.
const ADMIN_ORIGIN = process.env.ADMIN_ORIGIN || "https://admin.oreugo.ca";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Preview cap so a novel-length message doesn't inflate every email —
// operators click through to the admin UI for the full body anyway.
function truncate(s: string, n = 240): string {
  if (s.length <= n) return s;
  return s.slice(0, n).trimEnd() + "…";
}

export async function notifyAdminOfTenantReply(args: {
  threadId: string;
  threadSubject: string;
  senderName: string;
  senderRole: "MERCHANT" | "SUPPLIER";
  tenantName: string;
  bodyPreview: string;
}): Promise<void> {
  const recipients: string[] = [];
  if (SUPPORT_NOTIFY_EMAIL) recipients.push(SUPPORT_NOTIFY_EMAIL);

  // Extra addressee: the assigned admin, if the thread has one. Skip if
  // it's the same address we already have on the recipient list.
  const thread = await prisma.supportThread.findUnique({
    where: { id: args.threadId },
    select: { assignedAdminId: true },
  });
  if (thread?.assignedAdminId) {
    const admin = await prisma.adminUser.findUnique({
      where: { id: thread.assignedAdminId },
      select: { email: true, isActive: true },
    });
    if (admin?.isActive && admin.email && !recipients.includes(admin.email)) {
      recipients.push(admin.email);
    }
  }

  if (recipients.length === 0) return; // nowhere to send — silently no-op

  const preview = truncate(args.bodyPreview);
  const roleLabel = args.senderRole === "MERCHANT" ? "merchant" : "supplier";
  const threadUrl = `${ADMIN_ORIGIN}/support`;
  const subject = `[Support] ${args.tenantName} (${roleLabel}): ${args.threadSubject}`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f9fafb;">
  <div style="background:white;border-radius:12px;padding:28px;">
    <h2 style="color:#111827;margin:0 0 8px 0;font-size:18px;">New message on ${escapeHtml(args.threadSubject)}</h2>
    <p style="color:#6b7280;margin:0 0 16px 0;font-size:13px;">
      From <strong>${escapeHtml(args.senderName)}</strong> at <strong>${escapeHtml(args.tenantName)}</strong> (${roleLabel})
    </p>
    <div style="background:#f3f4f6;border-left:4px solid #4F46E5;padding:12px 16px;border-radius:6px;color:#111827;white-space:pre-wrap;font-size:14px;">
      ${escapeHtml(preview)}
    </div>
    <div style="margin:24px 0;text-align:center;">
      <a href="${threadUrl}" style="display:inline-block;background:#4F46E5;color:white;text-decoration:none;padding:10px 22px;border-radius:8px;font-weight:600;font-size:14px;">Open Support Inbox</a>
    </div>
    <p style="color:#9ca3af;font-size:11px;margin:0;">You&rsquo;re receiving this because your team monitors the support inbox.</p>
  </div>
</body>
</html>`;

  const text =
    `New message on ${args.threadSubject}\n` +
    `From ${args.senderName} at ${args.tenantName} (${roleLabel})\n\n` +
    `${preview}\n\n` +
    `Open the inbox: ${threadUrl}\n`;

  const command = new SendEmailCommand({
    Source: `Support Inbox <${FROM_EMAIL}>`,
    Destination: { ToAddresses: recipients },
    Message: {
      Subject: { Data: subject },
      Body: { Html: { Data: html }, Text: { Data: text } },
    },
  });
  await ses.send(command);
}
