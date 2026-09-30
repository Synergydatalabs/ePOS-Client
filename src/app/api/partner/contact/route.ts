// POST /api/partner/contact — Send contact form submission via email
// Uses SMTP credentials from env (per-tenant configurable)

import { NextRequest, NextResponse } from "next/server";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { resolveTenant } from "@/lib/tenant-resolver";
import { verifyRecaptcha, ipFromRequest } from "@/lib/recaptcha";

// Rate limit: simple in-memory tracker (IP → last submission time)
const submissions = new Map<string, number>();
const RATE_LIMIT_MS = 60_000; // 1 per minute per IP

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

    // Rate limit check
    const lastSubmission = submissions.get(ip);
    if (lastSubmission && Date.now() - lastSubmission < RATE_LIMIT_MS) {
      return NextResponse.json(
        { error: "Please wait a moment before submitting again." },
        { status: 429 }
      );
    }

    const body = await request.json();
    const { firstName, lastName, email, phone, company, interest, message, recaptchaToken } = body;

    // Soft-fail bot check: log rejections but let the form through.
    // Contact form is low-risk (an email to sales, no auth). Flip
    // RECAPTCHA_ENFORCE_AUTH=1 in prod for hard-block.
    const rc = await verifyRecaptcha({
      token: recaptchaToken || "",
      ip: ipFromRequest(request),
      expectedAction: "partner_contact",
    });
    if (!rc.ok) {
      // Phase I #4 (2026-09-11): HARD-FAIL — no bypass.
      console.warn(`[partner contact] reCAPTCHA rejected (${rc.reason})`);
      return NextResponse.json(
        { success: false, error: "Verification failed. Please refresh the page and try again." },
        { status: 403 }
      );
    }

    // Validation
    if (!firstName?.trim() || !email?.trim() || !company?.trim()) {
      return NextResponse.json(
        { error: "First name, email, and company are required." },
        { status: 400 }
      );
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: "Invalid email address." }, { status: 400 });
    }

    // Resolve tenant for branding context
    const hostname = request.headers.get("host") || "";
    const tenant = await resolveTenant(hostname);
    const brandName = tenant?.branding?.brandName || tenant?.name || "POS Inquiry";

    // Build email content
    const interestList = Array.isArray(interest) && interest.length > 0
      ? interest.join(", ")
      : "Not specified";

    // Determine recipient email from env
    const toEmail = process.env.CONTACT_FORM_EMAIL || "info@oreugo.ca";

    const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: #f9fafb; border-radius: 12px; padding: 30px;">
    <h2 style="color: #1f2937; margin-top: 0;">New Inquiry from ${brandName} Website</h2>
    <table style="width: 100%; border-collapse: collapse;">
      <tr><td style="padding: 8px 0; color: #6b7280; font-size: 14px; width: 120px;">Name</td><td style="padding: 8px 0; color: #1f2937; font-size: 14px;"><strong>${firstName} ${lastName || ""}</strong></td></tr>
      <tr><td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Email</td><td style="padding: 8px 0; color: #1f2937; font-size: 14px;"><a href="mailto:${email}">${email}</a></td></tr>
      ${phone ? `<tr><td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Phone</td><td style="padding: 8px 0; color: #1f2937; font-size: 14px;"><a href="tel:${phone}">${phone}</a></td></tr>` : ""}
      <tr><td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Company</td><td style="padding: 8px 0; color: #1f2937; font-size: 14px;">${company}</td></tr>
      <tr><td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Interested In</td><td style="padding: 8px 0; color: #1f2937; font-size: 14px;">${interestList}</td></tr>
    </table>
    ${message ? `<div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #e5e7eb;"><p style="color: #6b7280; font-size: 14px; margin: 0 0 8px 0;">Message</p><p style="color: #1f2937; font-size: 14px; line-height: 1.6; margin: 0;">${message.replace(/\n/g, "<br>")}</p></div>` : ""}
  </div>
  <p style="color: #9ca3af; font-size: 12px; text-align: center; margin-top: 20px;">
    Submitted via ${brandName} website &mdash; ${new Date().toISOString()}
  </p>
</body>
</html>`;

    const textBody = `New Inquiry from ${brandName} Website\n\nName: ${firstName} ${lastName || ""}\nEmail: ${email}\n${phone ? `Phone: ${phone}\n` : ""}Company: ${company}\nInterested In: ${interestList}\n${message ? `\nMessage:\n${message}` : ""}\n\nSubmitted: ${new Date().toISOString()}`;

    // Send via SES
    const ses = new SESClient({ region: process.env.AWS_REGION || "us-east-1" });
    const fromEmail = process.env.SES_FROM_EMAIL || "noreply@zashx.com";

    const command = new SendEmailCommand({
      Source: `${brandName} <${fromEmail}>`,
      Destination: { ToAddresses: [toEmail] },
      ReplyToAddresses: [email],
      Message: {
        Subject: { Data: `New Inquiry: ${firstName} ${lastName || ""} — ${company}` },
        Body: {
          Html: { Data: htmlBody },
          Text: { Data: textBody },
        },
      },
    });

    await ses.send(command);

    // Track submission for rate limiting
    submissions.set(ip, Date.now());
    // Cleanup old entries
    if (submissions.size > 10000) {
      const cutoff = Date.now() - RATE_LIMIT_MS * 10;
      for (const [key, val] of submissions) {
        if (val < cutoff) submissions.delete(key);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[PARTNER] Contact form error:", error);
    return NextResponse.json(
      { error: "Failed to send message. Please try again later." },
      { status: 500 }
    );
  }
}
