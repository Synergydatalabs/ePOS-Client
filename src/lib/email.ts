// Email utility using AWS SES for transactional emails (password reset, etc.)

import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const ses = new SESClient({ region: process.env.AWS_REGION || "us-east-1" });

const FROM_EMAIL = process.env.SES_FROM_EMAIL || "noreply@zashx.com";

// Phase F #2 (2026-08-27): supplier-issued invoices go from a Synergy Data
// Labs–verified SES identity by default so the customer sees a hub-branded
// sender. Falls back to SES_FROM_EMAIL if the invoice-specific address
// isn't set — a fresh deploy without SES_INVOICE_FROM_EMAIL still sends,
// just from whatever the platform default is. Other emails (password
// reset, PO lifecycle, welcome) are unaffected — they keep using
// FROM_EMAIL above.
const INVOICE_FROM_EMAIL =
  process.env.SES_INVOICE_FROM_EMAIL || FROM_EMAIL;

/**
 * Send a password reset email
 */
// Phase I #4 (2026-09-12): OTP-based password reset (replaces link
// flow). The 6-digit code goes straight into the email body — no URL,
// no token in the query string. User enters the code + a new password
// on /partner/reset-password.
export async function sendPasswordResetOtpEmail(params: {
  to: string;
  otp: string;
  businessName: string;
  brandName?: string;
  expiresInMinutes?: number;
}): Promise<void> {
  const displayName = params.brandName || params.businessName;
  const mins = params.expiresInMinutes ?? 15;

  const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; margin-bottom: 30px;">
    <h2 style="color: #1f2937; margin: 0;">${displayName}</h2>
  </div>
  <div style="background: #f9fafb; border-radius: 12px; padding: 30px; margin-bottom: 20px;">
    <h3 style="color: #1f2937; margin-top: 0;">Password reset code</h3>
    <p style="color: #4b5563; line-height: 1.6;">
      Enter this 6-digit code on the password reset page to choose a new
      password. The code expires in ${mins} minutes.
    </p>
    <div style="text-align: center; margin: 25px 0;">
      <div style="display: inline-block; background: #ffffff; border: 2px solid #4F46E5; color: #1f2937; padding: 18px 32px; border-radius: 12px; font-size: 32px; font-weight: 700; letter-spacing: 8px; font-family: 'SF Mono', Menlo, Consolas, monospace;">
        ${params.otp}
      </div>
    </div>
    <p style="color: #9ca3af; font-size: 13px;">
      If you didn't request a password reset, ignore this email — your
      password has not changed.
    </p>
  </div>
  <p style="color: #9ca3af; font-size: 12px; text-align: center;">
    ${displayName}
  </p>
</body>
</html>`;

  const textBody = `Password reset code - ${displayName}\n\nYour code: ${params.otp}\n\nEnter this 6-digit code on the password reset page. It expires in ${mins} minutes.\n\nIf you didn't request this, ignore this email — your password has not changed.`;

  const command = new SendEmailCommand({
    Source: FROM_EMAIL,
    Destination: { ToAddresses: [params.to] },
    Message: {
      Subject: { Data: `${displayName}: your password reset code` },
      Body: {
        Html: { Data: htmlBody },
        Text: { Data: textBody },
      },
    },
  });

  await ses.send(command);
}


/**
 * Send a supplier marketplace invite. Sent when a merchant adds a supplier
 * and clicks "Invite to Marketplace" — the supplier lands on the accept page
 * where they set a password and get their own supplier portal.
 *
 * We intentionally don't reveal the merchant's phone/address in this email —
 * only the business name is shared until the supplier accepts.
 */
export async function sendSupplierInviteEmail(params: {
  to: string;
  acceptUrl: string;
  merchantBusinessName: string;
  merchantContactName?: string;
  supplierCompanyName?: string;
  personalMessage?: string;
  expiresAt: Date;
}): Promise<void> {
  const supplierGreeting = params.supplierCompanyName
    ? `Hi ${params.supplierCompanyName} team,`
    : "Hi there,";

  const contactLine = params.merchantContactName
    ? `<strong>${escapeHtml(params.merchantContactName)}</strong> at <strong>${escapeHtml(params.merchantBusinessName)}</strong>`
    : `<strong>${escapeHtml(params.merchantBusinessName)}</strong>`;

  const contactLineText = params.merchantContactName
    ? `${params.merchantContactName} at ${params.merchantBusinessName}`
    : params.merchantBusinessName;

  const messageBlock = params.personalMessage?.trim()
    ? `<div style="background: white; border-left: 4px solid #4F46E5; padding: 15px 20px; margin: 20px 0; border-radius: 6px;">
         <p style="color: #4b5563; font-style: italic; margin: 0; line-height: 1.6;">
           &ldquo;${escapeHtml(params.personalMessage.trim())}&rdquo;
         </p>
       </div>`
    : "";

  const expiresFormatted = params.expiresAt.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9fafb;">
  <div style="background: white; border-radius: 12px; padding: 32px;">
    <h2 style="color: #1f2937; margin-top: 0;">You've been invited to join the hub by Synergy Data Labs</h2>
    <p style="color: #4b5563; line-height: 1.6;">${supplierGreeting}</p>
    <p style="color: #4b5563; line-height: 1.6;">
      ${contactLine} has invited your business to join their supplier network on iTap POS.
    </p>
    ${messageBlock}
    <p style="color: #4b5563; line-height: 1.6;">
      Accept the invite to set up your supplier account. You'll be able to list your products,
      receive purchase orders, and (optionally) accept payments through our platform.
    </p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${params.acceptUrl}" style="display: inline-block; background: #4F46E5; color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
        Accept Invitation
      </a>
    </div>
    <p style="color: #9ca3af; font-size: 13px; text-align: center;">
      This invitation expires on <strong>${expiresFormatted}</strong>.
    </p>
    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 25px 0;">
    <p style="color: #9ca3af; font-size: 12px; line-height: 1.5;">
      If you weren't expecting this invitation, you can safely ignore this email —
      no account will be created without you accepting.
    </p>
  </div>
  <p style="color: #9ca3af; font-size: 12px; text-align: center; margin-top: 20px;">
    hub by Synergy Data Labs
  </p>
</body>
</html>`;

  const textBody =
    `${supplierGreeting.replace(/,$/, "")}\n\n` +
    `${contactLineText} has invited your business to join their supplier network on iTap POS.\n\n` +
    (params.personalMessage?.trim() ? `Message from them:\n"${params.personalMessage.trim()}"\n\n` : "") +
    `Accept the invitation here (expires ${expiresFormatted}):\n${params.acceptUrl}\n\n` +
    `If you weren't expecting this, you can safely ignore this email.`;

  const command = new SendEmailCommand({
    Source: `hub by Synergy Data Labs <${FROM_EMAIL}>`,
    Destination: { ToAddresses: [params.to] },
    Message: {
      Subject: { Data: `${params.merchantBusinessName} invited you to join their supplier network` },
      Body: {
        Html: { Data: htmlBody },
        Text: { Data: textBody },
      },
    },
  });

  await ses.send(command);
}

/**
 * Escape a string for safe insertion into HTML. Small helper so we don't
 * pull in a whole templating library just for a handful of email fields.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Send a welcome email after partner registration
 */
export async function sendWelcomeEmail(params: {
  to: string;
  firstName: string;
  businessName: string;
  loginUrl: string;
}): Promise<void> {
  const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: #f9fafb; border-radius: 12px; padding: 30px;">
    <h2 style="color: #1f2937; margin-top: 0;">Welcome to iTAP POS, ${params.firstName}!</h2>
    <p style="color: #4b5563; line-height: 1.6;">
      Your business <strong>${params.businessName}</strong> has been set up successfully.
      You can now log in to manage your POS system.
    </p>
    <div style="text-align: center; margin: 25px 0;">
      <a href="${params.loginUrl}" style="display: inline-block; background: #4F46E5; color: white; text-decoration: none; padding: 12px 30px; border-radius: 8px; font-weight: 600;">
        Go to Dashboard
      </a>
    </div>
  </div>
</body>
</html>`;

  const command = new SendEmailCommand({
    Source: `iTAP POS <${FROM_EMAIL}>`,
    Destination: { ToAddresses: [params.to] },
    Message: {
      Subject: { Data: `Welcome to iTAP POS - ${params.businessName}` },
      Body: {
        Html: { Data: htmlBody },
        Text: { Data: `Welcome to iTAP POS, ${params.firstName}! Your business ${params.businessName} has been set up. Log in at: ${params.loginUrl}` },
      },
    },
  });

  await ses.send(command);
}

// ============================================================================
// PURCHASE ORDER NOTIFICATIONS — Phase B #63 (2026-07-30)
// ============================================================================
// One helper per lifecycle event. All share a common render path (renderPoEmail
// below) so the visual style stays consistent — merchants and suppliers get
// the same look-and-feel across every touchpoint.
//
// All senders are fire-and-forget from the callers' perspective — the caller
// wraps the send in a try/catch so a failed email never blocks the PO
// transition. Logging happens on both sides so ops can trace bad sends.
// ============================================================================

// Shared money formatter used by the templates.
function formatMoney(cents: number, currency: string): string {
  return `${currency} ${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// One-source-of-truth renderer for every PO email. Every template funnels
// through here so the visual chrome stays consistent across events. Keeps
// the wrapper HTML DRY — each event only owns its subject + inner body.
// Phase F #6u (2026-08-29): per-vendor branded invoice email. Mirrors the
// UI expert's handoff email design pixel-for-pixel — Deep Navy header,
// Electric Blue CTA, parent-endorsement footer with licence text. Used
// only when an invoice's product carries vendor branding; other emails
// keep renderPoEmail's minimal look.
/**
 * Vendor-branded invoice email — Mego brand pack v2 (2026-08-31 rebrand).
 * Pixel-matches the UI expert's `megopay-invoice-email.html` handoff:
 *   - Navy #0E2044 header band with white MEGO wordmark direct on navy
 *   - White card: h1 headline (navy), intro paragraph with statement
 *     descriptor bolded, three label/value rows (Invoice / Amount due /
 *     Items), Electric-Blue #006AFE pill CTA with VML fallback for Outlook,
 *     "Zero hidden fees · Secure transfers" trust line, divider, support
 *     footer with vendor.supportEmail link.
 *   - Outside card: small gray "{vendor} is a brand of {legalName}"
 *   - Table-based layout with inline CSS; mobile stack via @media query.
 *
 * RBI mentions removed per rebrand spec — the trust line no longer says
 * "RBI compliant" and the licence text is not shown in the email footer
 * (still lives on the pay page + T&C body).
 *
 * `intro` supports one **bolded** run per line — used to bold the
 * statement descriptor (e.g. "…as **MEGO PAY**."). Markdown-lite: text
 * between `**` becomes `<strong>` in the HTML output; plain text in the
 * text output.
 */
function renderVendorInvoiceEmail(params: {
  headline: string;
  intro: string;
  detailRows: { label: string; value: string }[];
  ctaUrl: string;
  ctaLabel: string;
  footerNote?: string;
  vendor: {
    name: string;
    logoUrl: string;          // absolute URL (email clients can't resolve /paths)
    brandColor: string;       // hex, e.g. #006AFE
    legalName?: string | null;
    licenseText?: string | null;
  };
  notesHtml?: string | null; // optional supplier notes block (pre-rendered)
}): { html: string; text: string } {
  // Brand tokens from the Mego email pack README (2026-08-31):
  //   header navy #0E2044 | CTA blue #006AFE | page #F6F7F9
  const navy = "#0E2044";
  const cta = params.vendor.brandColor || "#006AFE";
  const page = "#F6F7F9";

  // Escape + bold-run substitution. Only `**text**` → <strong>text</strong>.
  const introHtml = escapeHtml(params.intro).replace(
    /\*\*(.+?)\*\*/g,
    `<strong style="color:${navy};">$1</strong>`
  );
  // Text-only version drops the ** markers.
  const introText = params.intro.replace(/\*\*(.+?)\*\*/g, "$1");

  const detailsHtml = params.detailRows
    .map(
      (r) =>
        `<tr>
          <td class="stack" width="42%" style="padding:9px 0;font-size:15px;color:#6B7280;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">${escapeHtml(r.label)}</td>
          <td class="stack stack-v" style="padding:9px 0;font-size:15px;font-weight:700;color:${navy};font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">${escapeHtml(r.value)}</td>
        </tr>`
    )
    .join("");

  const endorsement = params.vendor.legalName
    ? `${escapeHtml(params.vendor.name)} is a brand of ${escapeHtml(params.vendor.legalName)}`
    : "";

  const ctaLabelEsc = escapeHtml(params.ctaLabel);

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light only" />
<meta name="supported-color-schemes" content="light only" />
<title>${escapeHtml(params.headline)}</title>
<!--[if mso]>
<style type="text/css">
  body,table,td,a,p{font-family:Arial,Helvetica,sans-serif !important;}
</style>
<![endif]-->
<style type="text/css">
  body{margin:0;padding:0;width:100% !important;background-color:${page};}
  img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;display:block;}
  table{border-collapse:collapse !important;}
  a{text-decoration:none;}
  @media only screen and (max-width:620px){
    .wrap{width:100% !important;}
    .pad{padding-left:24px !important;padding-right:24px !important;}
    .stack{display:block !important;width:100% !important;text-align:left !important;padding:0 0 2px 0 !important;}
    .stack-v{padding:0 0 16px 0 !important;}
    .cta a{display:block !important;}
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:${page};">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(params.headline)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${page};">
<tr><td align="center" style="padding:32px 12px;">
  <table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background-color:#FFFFFF;border-radius:12px;overflow:hidden;">
    <tr>
      <td class="pad" style="background-color:${navy};padding:26px 40px;">
        <img src="${params.vendor.logoUrl}" width="118" height="39" alt="${escapeHtml(params.vendor.name)}" style="display:block;width:118px;height:39px;border:0;" />
      </td>
    </tr>
    <tr>
      <td class="pad" style="padding:36px 40px 0 40px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
        <h1 style="margin:0 0 14px 0;font-size:22px;line-height:1.3;font-weight:700;color:${navy};">
          ${escapeHtml(params.headline)}
        </h1>
        ${params.notesHtml || ""}
        <p style="margin:0;font-size:15px;line-height:1.6;color:#4A5568;">
          ${introHtml}
        </p>
      </td>
    </tr>
    <tr>
      <td class="pad" style="padding:28px 40px 0 40px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          ${detailsHtml}
        </table>
      </td>
    </tr>
    <tr>
      <td align="center" class="pad cta" style="padding:32px 40px 0 40px;">
        <!--[if mso]>
        <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
          href="${params.ctaUrl}" style="height:48px;v-text-anchor:middle;width:220px;" arcsize="17%" stroke="f" fillcolor="${cta}">
          <w:anchorlock/>
          <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">${ctaLabelEsc}</center>
        </v:roundrect>
        <![endif]-->
        <!--[if !mso]><!-- -->
        <a href="${params.ctaUrl}"
           style="display:inline-block;background-color:${cta};color:#FFFFFF;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;font-weight:700;line-height:1;padding:16px 34px;border-radius:8px;">
          ${ctaLabelEsc}
        </a>
        <!--<![endif]-->
      </td>
    </tr>
    <tr>
      <td align="center" class="pad" style="padding:22px 40px 0 40px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;font-weight:700;color:${navy};">
        Zero hidden fees &middot; Secure transfers
      </td>
    </tr>
    <tr>
      <td class="pad" style="padding:28px 40px 0 40px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="border-top:1px solid #EDEFF2;font-size:0;line-height:0;">&nbsp;</td></tr>
        </table>
      </td>
    </tr>
    ${
      params.footerNote
        ? `<tr>
      <td class="pad" style="padding:20px 40px 34px 40px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#9CA3AF;">
        ${params.footerNote}
      </td>
    </tr>`
        : ""
    }
  </table>
  ${
    endorsement
      ? `<table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">
    <tr>
      <td align="center" style="padding:22px 24px 0 24px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#9CA3AF;">
        ${endorsement}
      </td>
    </tr>
  </table>`
      : ""
  }
</td></tr>
</table>
</body>
</html>`;

  const text =
    `${params.headline}\n\n` +
    `${introText}\n\n` +
    params.detailRows.map((r) => `${r.label}: ${r.value}`).join("\n") +
    `\n\n${params.ctaLabel}: ${params.ctaUrl}\n` +
    `\nZero hidden fees · Secure transfers\n` +
    (params.footerNote ? `\n${params.footerNote.replace(/<[^>]*>/g, "")}\n` : "") +
    (endorsement ? `\n${params.vendor.name} is a brand of ${params.vendor.legalName || ""}\n` : "");

  return { html, text };
}

function renderPoEmail(params: {
  subject: string;
  headline: string;
  intro: string;
  detailRows: { label: string; value: string }[];
  ctaUrl: string;
  ctaLabel: string;
  ctaColor?: string;
  footerNote?: string;
}): { html: string; text: string } {
  const accent = params.ctaColor || "#4F46E5";
  const detailsHtml = params.detailRows
    .map(
      (r) =>
        `<tr>
           <td style="padding: 6px 0; color: #6b7280; font-size: 13px; width: 40%;">${escapeHtml(r.label)}</td>
           <td style="padding: 6px 0; color: #111827; font-size: 13px; font-weight: 600;">${escapeHtml(r.value)}</td>
         </tr>`
    )
    .join("");

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9fafb;">
  <div style="background: white; border-radius: 12px; padding: 32px;">
    <h2 style="color: #111827; margin: 0 0 12px 0;">${escapeHtml(params.headline)}</h2>
    <p style="color: #4b5563; line-height: 1.6; margin: 0 0 20px 0;">${escapeHtml(params.intro)}</p>
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
      ${detailsHtml}
    </table>
    <div style="text-align: center; margin: 25px 0;">
      <a href="${params.ctaUrl}" style="display: inline-block; background: ${accent}; color: white; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 14px;">
        ${escapeHtml(params.ctaLabel)}
      </a>
    </div>
    ${
      params.footerNote
        ? `<p style="color: #9ca3af; font-size: 12px; line-height: 1.5; margin: 20px 0 0 0;">${escapeHtml(params.footerNote)}</p>`
        : ""
    }
  </div>
  <p style="color: #9ca3af; font-size: 12px; text-align: center; margin-top: 20px;">
    hub by Synergy Data Labs
  </p>
</body>
</html>`;

  const text =
    `${params.headline}\n\n` +
    `${params.intro}\n\n` +
    params.detailRows.map((r) => `${r.label}: ${r.value}`).join("\n") +
    `\n\n${params.ctaLabel}: ${params.ctaUrl}\n` +
    (params.footerNote ? `\n${params.footerNote}\n` : "");

  return { html, text };
}

async function sendPoEmail(params: {
  to: string;
  subject: string;
  fromLabel: string;
  rendered: { html: string; text: string };
  // Optional From-address override — used by supplier invoices so they
  // ship from cloud@synergydatalabs.com instead of the platform default.
  // Everything else omits it and gets FROM_EMAIL.
  fromEmail?: string;
  // Phase F #6k (2026-08-28): CC recipients. Optional; ignored if empty.
  // De-duped against `to` to avoid double-send to the primary recipient.
  cc?: string[];
}): Promise<void> {
  const primary = params.to.trim().toLowerCase();
  const ccList = (params.cc || [])
    .map((e) => e.trim())
    .filter((e) => e && e.toLowerCase() !== primary);
  const command = new SendEmailCommand({
    Source: `${params.fromLabel} <${params.fromEmail || FROM_EMAIL}>`,
    Destination: {
      ToAddresses: [params.to],
      ...(ccList.length ? { CcAddresses: ccList } : {}),
    },
    Message: {
      Subject: { Data: params.subject },
      Body: {
        Html: { Data: params.rendered.html },
        Text: { Data: params.rendered.text },
      },
    },
  });
  await ses.send(command);
}

// --- 1. New PO submitted → email supplier -----------------------------------

export async function sendPoSubmittedEmail(params: {
  to: string;
  poNumber: string;
  merchantName: string;
  itemCount: number;
  totalCents: number;
  currency: string;
  supplierPoUrl: string;
}): Promise<void> {
  const rendered = renderPoEmail({
    subject: `New PO ${params.poNumber} from ${params.merchantName}`,
    headline: `New order from ${params.merchantName}`,
    intro: `You've received a new purchase order. Acknowledge it to let them know you're on it.`,
    detailRows: [
      { label: "PO number", value: params.poNumber },
      { label: "Items", value: `${params.itemCount} line item${params.itemCount !== 1 ? "s" : ""}` },
      { label: "Total", value: formatMoney(params.totalCents, params.currency) },
    ],
    ctaUrl: params.supplierPoUrl,
    ctaLabel: "Review Purchase Order",
  });
  await sendPoEmail({
    to: params.to,
    subject: `New PO ${params.poNumber} from ${params.merchantName}`,
    fromLabel: "hub by Synergy Data Labs",
    rendered,
  });
}

// --- 2. PO acknowledged → email merchant ------------------------------------

export async function sendPoAcknowledgedEmail(params: {
  to: string;
  poNumber: string;
  supplierName: string;
  merchantPoUrl: string;
}): Promise<void> {
  const rendered = renderPoEmail({
    subject: `PO ${params.poNumber} acknowledged by ${params.supplierName}`,
    headline: `${params.supplierName} acknowledged your order`,
    intro: `Your purchase order has been received and confirmed. Next update: shipment.`,
    detailRows: [
      { label: "PO number", value: params.poNumber },
      { label: "Supplier", value: params.supplierName },
    ],
    ctaUrl: params.merchantPoUrl,
    ctaLabel: "View Order",
  });
  await sendPoEmail({
    to: params.to,
    subject: `PO ${params.poNumber} acknowledged by ${params.supplierName}`,
    fromLabel: "hub by Synergy Data Labs",
    rendered,
  });
}

// --- 3. PO shipped → email merchant -----------------------------------------

export async function sendPoShippedEmail(params: {
  to: string;
  poNumber: string;
  supplierName: string;
  carrier?: string | null;
  trackingRef?: string | null;
  expectedDeliveryAt?: Date | null;
  merchantPoUrl: string;
}): Promise<void> {
  const detailRows: { label: string; value: string }[] = [
    { label: "PO number", value: params.poNumber },
    { label: "Supplier", value: params.supplierName },
  ];
  if (params.carrier) detailRows.push({ label: "Carrier", value: params.carrier });
  if (params.trackingRef) detailRows.push({ label: "Tracking", value: params.trackingRef });
  if (params.expectedDeliveryAt) {
    detailRows.push({
      label: "Expected delivery",
      value: params.expectedDeliveryAt.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
    });
  }

  const rendered = renderPoEmail({
    subject: `PO ${params.poNumber} has shipped`,
    headline: `Your order is on the way`,
    intro: `${params.supplierName} has shipped your purchase order. Please confirm receipt when it arrives so we can update your inventory.`,
    detailRows,
    ctaUrl: params.merchantPoUrl,
    ctaLabel: "Track Order",
    ctaColor: "#f59e0b", // amber, matches the "in transit" status pill
  });
  await sendPoEmail({
    to: params.to,
    subject: `PO ${params.poNumber} has shipped`,
    fromLabel: "hub by Synergy Data Labs",
    rendered,
  });
}

// --- 4. PO delivered → email supplier ---------------------------------------

export async function sendPoDeliveredEmail(params: {
  to: string;
  poNumber: string;
  merchantName: string;
  supplierPoUrl: string;
}): Promise<void> {
  const rendered = renderPoEmail({
    subject: `PO ${params.poNumber} — delivery confirmed`,
    headline: `${params.merchantName} confirmed delivery`,
    intro: `Order complete — thanks for fulfilling! The purchase order has been marked as delivered.`,
    detailRows: [
      { label: "PO number", value: params.poNumber },
      { label: "Merchant", value: params.merchantName },
    ],
    ctaUrl: params.supplierPoUrl,
    ctaLabel: "View Order",
    ctaColor: "#10b981", // emerald, matches "delivered" status pill
  });
  await sendPoEmail({
    to: params.to,
    subject: `PO ${params.poNumber} — delivery confirmed`,
    fromLabel: "hub by Synergy Data Labs",
    rendered,
  });
}

// ============================================================================
// GATEWAY APPLICATION NOTIFICATIONS — Phase C #66 (2026-07-30)
// ============================================================================
// Admin-triggered emails when reviewing a supplier's gateway application.
// Never include PII / KYB data — those live in the platform admin UI only.
// Processor-facing lead is intentionally short: intros the supplier + a
// contact, invites the processor to reply with their onboarding link.

export async function sendGatewayInfoRequestedEmail(params: {
  to: string;
  supplierName: string;
  requestBody: string;
  applicationUrl: string;
}): Promise<void> {
  const rendered = renderPoEmail({
    subject: `We need more info on your gateway application`,
    headline: `A quick follow-up on your payment gateway application`,
    intro: `Our reviewer needs some additional information before we can forward this to a processor.`,
    detailRows: [{ label: "Business", value: params.supplierName }],
    ctaUrl: params.applicationUrl,
    ctaLabel: "Review Your Application",
    ctaColor: "#f59e0b",
    footerNote:
      "Reply to this email with the requested info, or submit a new application with the corrections.",
  });
  // The requested-info body is prepended into the intro so the supplier sees
  // exactly what's being asked. Keeps them from having to click to figure out.
  const withDetails = {
    html: rendered.html.replace(
      "additional information before we can forward this to a processor.",
      `additional information before we can forward this to a processor:</p><div style="background:#fff8ec;border-left:4px solid #f59e0b;padding:12px 16px;margin:12px 0;border-radius:6px;color:#4b5563;font-size:14px;white-space:pre-wrap;">${escapeHtml(
        params.requestBody
      )}</div><p style="color:#4b5563;line-height:1.6;margin:0 0 20px 0;">Once you've responded we'll pick it up.`
    ),
    text: rendered.text.replace(
      "additional information before we can forward this to a processor.",
      `additional information before we can forward this to a processor:\n\n${params.requestBody}\n\nOnce you've responded we'll pick it up.`
    ),
  };
  await sendPoEmail({
    to: params.to,
    subject: `We need more info on your gateway application`,
    fromLabel: "hub by Synergy Data Labs",
    rendered: withDetails,
  });
}

export async function sendGatewayForwardedEmail(params: {
  to: string;
  supplierName: string;
  processor: string;
  applicationUrl: string;
}): Promise<void> {
  const rendered = renderPoEmail({
    subject: `Your gateway application is with ${params.processor}`,
    headline: `Handed off to ${params.processor}`,
    intro: `We've forwarded your application to ${params.processor}. They'll be in touch with next steps (usually a secure onboarding link + a call).`,
    detailRows: [
      { label: "Business", value: params.supplierName },
      { label: "Processor", value: params.processor },
    ],
    ctaUrl: params.applicationUrl,
    ctaLabel: "View Application Status",
    ctaColor: "#8b5cf6",
    footerNote:
      "Timelines vary by processor but typical underwriting takes 5–15 business days. We'll let you know as soon as we hear back.",
  });
  await sendPoEmail({
    to: params.to,
    subject: `Your gateway application is with ${params.processor}`,
    fromLabel: "hub by Synergy Data Labs",
    rendered,
  });
}

export async function sendGatewayApprovedEmail(params: {
  to: string;
  supplierName: string;
  processor: string;
  externalMid: string;
  paymentsUrl: string;
}): Promise<void> {
  const rendered = renderPoEmail({
    subject: `You're live on ${params.processor}!`,
    headline: `Approved — your payment gateway is live`,
    intro: `Every new purchase order you receive from now on will include a payment link the merchant can click to pay by card. Funds will settle directly to your bank.`,
    detailRows: [
      { label: "Business", value: params.supplierName },
      { label: "Processor", value: params.processor },
      { label: "Merchant ID", value: params.externalMid },
    ],
    ctaUrl: params.paymentsUrl,
    ctaLabel: "Go to Payments",
    ctaColor: "#10b981",
  });
  await sendPoEmail({
    to: params.to,
    subject: `You're live on ${params.processor}!`,
    fromLabel: "hub by Synergy Data Labs",
    rendered,
  });
}

export async function sendGatewayRejectedEmail(params: {
  to: string;
  supplierName: string;
  reason: string;
  applicationUrl: string;
}): Promise<void> {
  const rendered = renderPoEmail({
    subject: `Your gateway application was declined`,
    headline: `Application declined`,
    intro: `We weren't able to approve this application. See the reason below — you're welcome to submit a fresh application at any time.`,
    detailRows: [
      { label: "Business", value: params.supplierName },
      { label: "Reason", value: params.reason },
    ],
    ctaUrl: params.applicationUrl,
    ctaLabel: "View Application",
    ctaColor: "#6b7280",
    footerNote:
      "If you think this was a mistake, reply to this email and we'll take another look.",
  });
  await sendPoEmail({
    to: params.to,
    subject: `Your gateway application was declined`,
    fromLabel: "hub by Synergy Data Labs",
    rendered,
  });
}

// Processor-facing lead. Deliberately does NOT include PII / KYB — real
// onboarding data goes through the processor's secure channel, not email.
// This is just an intro so the processor's onboarding team knows to expect
// a merchant referral and can send back their onboarding link.
export async function sendGatewayProcessorLeadEmail(params: {
  to: string; // processor's onboarding team
  supplierName: string;
  supplierContactName: string | null;
  supplierContactEmail: string;
  supplierContactPhone: string | null;
  processorName: string;
  projectedMonthlyVolume: string | null;
  averageTicket: string | null;
  region: string | null;
  websiteUrl: string | null;
  mccCode: string | null;
  fromAdminEmail: string;
}): Promise<void> {
  const contactLine = params.supplierContactName
    ? `${params.supplierContactName} (${params.supplierContactEmail})`
    : params.supplierContactEmail;

  const detailRows = [
    { label: "Business", value: params.supplierName },
    { label: "Contact", value: contactLine },
  ];
  if (params.supplierContactPhone) detailRows.push({ label: "Phone", value: params.supplierContactPhone });
  if (params.region) detailRows.push({ label: "Region", value: params.region });
  if (params.websiteUrl) detailRows.push({ label: "Website", value: params.websiteUrl });
  if (params.mccCode) detailRows.push({ label: "MCC", value: params.mccCode });
  if (params.projectedMonthlyVolume)
    detailRows.push({ label: "Projected monthly volume", value: params.projectedMonthlyVolume });
  if (params.averageTicket)
    detailRows.push({ label: "Average ticket", value: params.averageTicket });

  const rendered = renderPoEmail({
    subject: `Merchant referral: ${params.supplierName} (via iTap)`,
    headline: `New merchant referral — ${params.supplierName}`,
    intro: `We'd like to refer this business to ${params.processorName} for a merchant account. They're already listed on our supplier marketplace and are ready to accept card payments. Please reply with your secure onboarding link (or preferred next step) and we'll route them to you.`,
    detailRows,
    ctaUrl: `mailto:${params.supplierContactEmail}`,
    ctaLabel: "Contact Merchant",
    footerNote: `Referral coordinated by ${params.fromAdminEmail}. Full KYB data is held securely on our platform and will be provided through your secure onboarding channel — not this email.`,
  });
  await sendPoEmail({
    to: params.to,
    subject: `Merchant referral: ${params.supplierName} (via iTap)`,
    fromLabel: "iTap Marketplace Partnerships",
    rendered,
  });
}

// --- 9. Statement → email the MERCHANT with their outstanding AR ----------

export async function sendStatementEmail(params: {
  to: string;
  merchantName: string;
  supplierName: string;
  currency: string;
  asOf: Date;
  netTermsDays: number;
  totalOutstandingCents: number;
  aging: {
    notYetDue: number;
    "1_30": number;
    "31_60": number;
    "61_90": number;
    over_90: number;
  };
  lines: {
    poNumber: string;
    submittedAt: Date;
    dueDate: Date;
    daysOverdue: number;
    totalCents: number;
    paidAmountCents: number;
    outstandingCents: number;
  }[];
  merchantPortalUrl: string;
  extraNote?: string;
}): Promise<void> {
  const fmtMoney = (c: number) =>
    `${params.currency} ${(c / 100).toFixed(2)}`;
  const fmtDate = (d: Date) => d.toLocaleDateString();

  // Build a compact line-items HTML table separately — renderPoEmail's
  // detailRows are label:value pairs, not great for a many-row PO list.
  const lineRowsHtml = params.lines
    .map(
      (l) =>
        `<tr>
          <td style="padding:6px 8px; border-bottom:1px solid #eee; font-size:12px; font-family:monospace;">${escapeHtml(l.poNumber)}</td>
          <td style="padding:6px 8px; border-bottom:1px solid #eee; font-size:12px;">${fmtDate(l.submittedAt)}</td>
          <td style="padding:6px 8px; border-bottom:1px solid #eee; font-size:12px;">${fmtDate(l.dueDate)}</td>
          <td style="padding:6px 8px; border-bottom:1px solid #eee; font-size:12px; text-align:right; ${l.daysOverdue > 0 ? "color:#b91c1c;font-weight:600;" : "color:#6b7280;"}">${
            l.daysOverdue > 0 ? `${l.daysOverdue}d late` : "on time"
          }</td>
          <td style="padding:6px 8px; border-bottom:1px solid #eee; font-size:12px; text-align:right; font-weight:600;">${fmtMoney(l.outstandingCents)}</td>
        </tr>`
    )
    .join("");
  const lineTextRows = params.lines
    .map(
      (l) =>
        `  ${l.poNumber}   submitted ${fmtDate(l.submittedAt)}   due ${fmtDate(l.dueDate)}   ${
          l.daysOverdue > 0 ? `${l.daysOverdue}d late` : "on time"
        }   ${fmtMoney(l.outstandingCents)}`
    )
    .join("\n");

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px; background: #f9fafb;">
  <div style="background: white; border-radius: 12px; padding: 32px;">
    <h2 style="color: #111827; margin: 0 0 4px 0;">Statement of Account</h2>
    <p style="color: #6b7280; margin: 0 0 20px 0; font-size: 13px;">
      From <strong>${escapeHtml(params.supplierName)}</strong> · As of ${fmtDate(params.asOf)}
    </p>

    <p style="color: #4b5563; line-height: 1.6; margin: 0 0 16px 0;">
      Hi ${escapeHtml(params.merchantName)}, here's a summary of your outstanding
      balance with us. Payment terms: Net ${params.netTermsDays}.
    </p>

    ${
      params.extraNote
        ? `<p style="color: #4b5563; line-height: 1.6; margin: 0 0 16px 0; padding: 12px; background: #f3f4f6; border-radius: 8px; font-style: italic;">${escapeHtml(params.extraNote)}</p>`
        : ""
    }

    <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
      <p style="color: #6b7280; margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em;">Total outstanding</p>
      <p style="color: #111827; margin: 4px 0 0 0; font-size: 28px; font-weight: 700;">${fmtMoney(params.totalOutstandingCents)}</p>
    </div>

    <h3 style="color: #111827; margin: 0 0 8px 0; font-size: 14px;">Aging summary</h3>
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
      <tr style="background: #f3f4f6;">
        <th style="padding: 6px 8px; font-size: 11px; color: #6b7280; text-align: left;">Not yet due</th>
        <th style="padding: 6px 8px; font-size: 11px; color: #6b7280; text-align: left;">1–30 days</th>
        <th style="padding: 6px 8px; font-size: 11px; color: #6b7280; text-align: left;">31–60 days</th>
        <th style="padding: 6px 8px; font-size: 11px; color: #6b7280; text-align: left;">61–90 days</th>
        <th style="padding: 6px 8px; font-size: 11px; color: #6b7280; text-align: left;">90+ days</th>
      </tr>
      <tr>
        <td style="padding: 8px; font-size: 13px; font-weight: 600; color: #111827;">${fmtMoney(params.aging.notYetDue)}</td>
        <td style="padding: 8px; font-size: 13px; font-weight: 600; color: ${params.aging["1_30"] > 0 ? "#c2410c" : "#111827"};">${fmtMoney(params.aging["1_30"])}</td>
        <td style="padding: 8px; font-size: 13px; font-weight: 600; color: ${params.aging["31_60"] > 0 ? "#c2410c" : "#111827"};">${fmtMoney(params.aging["31_60"])}</td>
        <td style="padding: 8px; font-size: 13px; font-weight: 600; color: ${params.aging["61_90"] > 0 ? "#b91c1c" : "#111827"};">${fmtMoney(params.aging["61_90"])}</td>
        <td style="padding: 8px; font-size: 13px; font-weight: 600; color: ${params.aging.over_90 > 0 ? "#b91c1c" : "#111827"};">${fmtMoney(params.aging.over_90)}</td>
      </tr>
    </table>

    <h3 style="color: #111827; margin: 0 0 8px 0; font-size: 14px;">Open purchase orders</h3>
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
      <tr style="background: #f3f4f6;">
        <th style="padding: 6px 8px; font-size: 11px; color: #6b7280; text-align: left;">PO #</th>
        <th style="padding: 6px 8px; font-size: 11px; color: #6b7280; text-align: left;">Submitted</th>
        <th style="padding: 6px 8px; font-size: 11px; color: #6b7280; text-align: left;">Due</th>
        <th style="padding: 6px 8px; font-size: 11px; color: #6b7280; text-align: right;">Age</th>
        <th style="padding: 6px 8px; font-size: 11px; color: #6b7280; text-align: right;">Outstanding</th>
      </tr>
      ${lineRowsHtml}
    </table>

    <div style="text-align: center; margin: 25px 0;">
      <a href="${params.merchantPortalUrl}" style="display: inline-block; background: #4F46E5; color: white; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 14px;">
        View Orders in Portal
      </a>
    </div>

    <p style="color: #9ca3af; font-size: 12px; line-height: 1.5; margin: 20px 0 0 0;">
      Each PO has its own payment link on your Orders page. If you've already
      paid an item on this statement, please disregard — payments may take a
      few minutes to reconcile.
    </p>
  </div>
  <p style="color: #9ca3af; font-size: 12px; text-align: center; margin-top: 20px;">
    hub by Synergy Data Labs
  </p>
</body>
</html>`;

  const text =
    `Statement of Account\n` +
    `From ${params.supplierName} — As of ${fmtDate(params.asOf)}\n\n` +
    `Total outstanding: ${fmtMoney(params.totalOutstandingCents)}\n` +
    `Terms: Net ${params.netTermsDays}\n\n` +
    (params.extraNote ? `Note: ${params.extraNote}\n\n` : "") +
    `Aging:\n` +
    `  Not yet due:  ${fmtMoney(params.aging.notYetDue)}\n` +
    `  1-30 days:    ${fmtMoney(params.aging["1_30"])}\n` +
    `  31-60 days:   ${fmtMoney(params.aging["31_60"])}\n` +
    `  61-90 days:   ${fmtMoney(params.aging["61_90"])}\n` +
    `  90+ days:     ${fmtMoney(params.aging.over_90)}\n\n` +
    `Open POs:\n${lineTextRows}\n\n` +
    `View orders: ${params.merchantPortalUrl}\n`;

  await sendPoEmail({
    to: params.to,
    subject: `Statement from ${params.supplierName} — ${fmtMoney(params.totalOutstandingCents)} outstanding`,
    fromLabel: "hub by Synergy Data Labs",
    rendered: { html, text },
  });
}

// --- 8. New PO message → email the OTHER side ------------------------------

export async function sendPoNewMessageEmail(params: {
  to: string;
  poNumber: string;
  senderName: string;
  senderSide: "MERCHANT" | "SUPPLIER";
  bodyPreview: string;
  recipientPoUrl: string;
}): Promise<void> {
  // Truncate the preview so a very long message doesn't blow up the email.
  const previewCap = 240;
  const preview =
    params.bodyPreview.length > previewCap
      ? params.bodyPreview.slice(0, previewCap).trimEnd() + "…"
      : params.bodyPreview;

  const rendered = renderPoEmail({
    subject: `New message on PO ${params.poNumber}`,
    headline: `${params.senderName} sent you a message`,
    intro: `A new message was posted on the thread for this purchase order.`,
    detailRows: [
      { label: "PO number", value: params.poNumber },
      { label: "From", value: `${params.senderName} (${params.senderSide === "MERCHANT" ? "merchant" : "supplier"})` },
      { label: "Message", value: preview },
    ],
    ctaUrl: params.recipientPoUrl,
    ctaLabel: "Open Thread",
    footerNote:
      "You'll receive one email per new message today. Message-digest preferences are coming.",
  });
  await sendPoEmail({
    to: params.to,
    subject: `New message on PO ${params.poNumber}`,
    fromLabel: "hub by Synergy Data Labs",
    rendered,
  });
}

// --- 6. PO paid → email the SUPPLIER ("you got paid!") --------------------

export async function sendPoPaidSupplierEmail(params: {
  to: string;
  poNumber: string;
  merchantName: string;
  amountCents: number;
  currency: string;
  paidMethod: string;
  supplierPoUrl: string;
}): Promise<void> {
  const rendered = renderPoEmail({
    subject: `Paid: PO ${params.poNumber} — ${formatMoney(params.amountCents, params.currency)} from ${params.merchantName}`,
    headline: `You've been paid`,
    intro: `Payment for this purchase order has been captured. Funds will settle to your bank per your processor's usual timing.`,
    detailRows: [
      { label: "PO number", value: params.poNumber },
      { label: "Merchant", value: params.merchantName },
      { label: "Amount", value: formatMoney(params.amountCents, params.currency) },
      { label: "Method", value: params.paidMethod },
    ],
    ctaUrl: params.supplierPoUrl,
    ctaLabel: "View Order",
    ctaColor: "#10b981",
  });
  await sendPoEmail({
    to: params.to,
    subject: `Paid: PO ${params.poNumber}`,
    fromLabel: "hub by Synergy Data Labs",
    rendered,
  });
}

// --- 7. PO paid → email the MERCHANT (payment confirmation receipt) -------

export async function sendPoPaidMerchantEmail(params: {
  to: string;
  poNumber: string;
  supplierName: string;
  amountCents: number;
  currency: string;
  paidMethod: string;
  merchantPoUrl: string;
}): Promise<void> {
  const rendered = renderPoEmail({
    subject: `Payment received for PO ${params.poNumber} — ${formatMoney(params.amountCents, params.currency)}`,
    headline: `Payment received`,
    intro: `Your payment to ${params.supplierName} for this purchase order has been processed successfully. Keep this email as your receipt.`,
    detailRows: [
      { label: "PO number", value: params.poNumber },
      { label: "Supplier", value: params.supplierName },
      { label: "Amount", value: formatMoney(params.amountCents, params.currency) },
      { label: "Method", value: params.paidMethod },
    ],
    ctaUrl: params.merchantPoUrl,
    ctaLabel: "View Order",
    ctaColor: "#10b981",
  });
  await sendPoEmail({
    to: params.to,
    subject: `Payment received for PO ${params.poNumber}`,
    fromLabel: "hub by Synergy Data Labs",
    rendered,
  });
}

// --- 5. PO cancelled → email the OTHER side --------------------------------

export async function sendPoCancelledEmail(params: {
  to: string;
  poNumber: string;
  otherPartyName: string; // whoever cancelled, from the recipient's POV
  cancelledBy: "merchant" | "supplier";
  cancellationReason: string;
  recipientPoUrl: string;
}): Promise<void> {
  const rendered = renderPoEmail({
    subject: `PO ${params.poNumber} was cancelled`,
    headline: `Purchase order cancelled`,
    intro: `${params.otherPartyName} (${params.cancelledBy}) cancelled this order.`,
    detailRows: [
      { label: "PO number", value: params.poNumber },
      { label: "Cancelled by", value: params.otherPartyName },
      { label: "Reason", value: params.cancellationReason },
    ],
    ctaUrl: params.recipientPoUrl,
    ctaLabel: "View Order",
    ctaColor: "#6b7280", // gray, matches "cancelled" status pill
    footerNote:
      "If you have questions, reach out directly — cancellation is a two-way street.",
  });
  await sendPoEmail({
    to: params.to,
    subject: `PO ${params.poNumber} was cancelled`,
    fromLabel: "hub by Synergy Data Labs",
    rendered,
  });
}

// =============================================================================
// Phase F #2 (2026-08-27) — Supplier-issued invoice email.
//
// Emails an external customer the payment link + a summary of what they
// owe. Skinned in the supplier's brand color so it feels like it came
// from the supplier, not from hub. The "From" label uses the supplier's
// display name (e.g. "Synergy Data Labs"), not the generic hub label
// used by the PO email templates.
// =============================================================================

export async function sendSupplierInvoiceEmail(params: {
  to: string;
  // Phase F #6k (2026-08-28): optional CC recipients.
  cc?: string[];
  supplierDisplayName: string;
  supplierContactEmail?: string | null;
  invoiceNumber: string;
  totalCents: number;
  currency: string;
  itemCount: number;
  paymentLinkUrl: string;
  brandPrimaryColor?: string | null;
  notes?: string | null;
  // Phase F #6u (2026-08-29): optional vendor block. When set, the email
  // renders in the vendor's brand (Deep Navy header, Electric Blue CTA,
  // parent endorsement footer) and the "From" label is the vendor's name.
  // Non-vendor invoices keep the existing hub layout.
  vendor?: {
    name: string;
    logoUrl: string | null;   // may be relative (/images/...) — absolutised below
    brandColor: string;       // hex #RRGGBB
    legalName?: string | null;
    licenseText?: string | null;
    statementDescriptor?: string | null;
    // #Rebrand: vendor's own support email (product support goes here,
    // not to the reseller). When present, footer's "write to X" link
    // uses this instead of supplierContactEmail.
    supportEmail?: string | null;
  } | null;
  // Phase G #1 (2026-08-30): subscription context. When set, the email
  // adds a "This is invoice N of your recurring subscription — cancel
  // anytime" line + a cancel link into the footer. Absent = one-off
  // invoice email (existing behaviour).
  subscription?: {
    sequence: number;      // 1 for first invoice, 2+ for recurring
    interval: "MONTHLY" | "ANNUAL" | string;
    cancelUrl: string;     // full https://…/subscriptions/[token]/cancel
  } | null;
}): Promise<void> {
  const brandColor = params.brandPrimaryColor || "#0F766E";
  const total = formatMoney(params.totalCents, params.currency);
  const inVendorMode = Boolean(params.vendor);
  // Subject line: vendor-branded when set so the buyer's inbox shows the
  // product's real brand, not just the reseller's name.
  const subject = inVendorMode
    ? `${params.vendor!.name} invoice ${params.invoiceNumber} — ${total}`
    : `Invoice ${params.invoiceNumber} from ${params.supplierDisplayName} — ${total}`;
  const detailRows: { label: string; value: string }[] = [
    { label: "Invoice", value: params.invoiceNumber },
    { label: "Amount due", value: total },
    { label: "Items", value: `${params.itemCount} line item${params.itemCount !== 1 ? "s" : ""}` },
  ];

  let rendered: { html: string; text: string };
  if (inVendorMode) {
    // Absolutise the vendor logo URL: email clients cannot resolve relative
    // paths, so /images/x.png must become https://host/images/x.png.
    // Derive the origin from paymentLinkUrl (a full URL the caller already
    // built), which points at the same host that serves the logo.
    let logoAbs = params.vendor!.logoUrl || "";
    if (logoAbs && logoAbs.startsWith("/")) {
      try {
        const origin = new URL(params.paymentLinkUrl).origin;
        logoAbs = origin + logoAbs;
      } catch {
        /* leave relative — logo just won't render */
      }
    }
    // Notes block, pre-rendered, injected above the intro paragraph.
    let notesHtml: string | null = null;
    if (params.notes && params.notes.trim()) {
      const notesEsc = escapeHtml(params.notes.trim());
      notesHtml = `<div style="background: #F5F7F8; border-left: 3px solid ${params.vendor!.brandColor}; padding: 12px 16px; margin: 0 0 16px 0; font-size: 13px; color: #4b5563; line-height: 1.5; white-space: pre-line;">${notesEsc}</div>`;
    }
    // Intro copy for vendor mode adds the statement-descriptor notice
    // (so the buyer recognises the charge on their bill). The **…** run
    // is picked up by the renderer and swapped for <strong>…</strong>.
    const statementLine = params.vendor!.statementDescriptor
      ? ` This charge will appear on your statement as **${params.vendor!.statementDescriptor}**.`
      : "";
    // #G1: prepend subscription context to headline + intro when this
    // invoice belongs to a subscription. Sequence 1 uses different copy
    // than sequence 2+ ("first invoice" vs "recurring invoice N").
    const sub = params.subscription;
    const isSub = Boolean(sub);
    const intervalWord = sub?.interval === "ANNUAL" ? "annual" : "monthly";
    const headline = isSub
      ? sub!.sequence === 1
        ? `${params.vendor!.name} — first invoice for your ${intervalWord} subscription`
        : `${params.vendor!.name} — invoice ${sub!.sequence} of your ${intervalWord} subscription`
      : `${params.vendor!.name} sent you an invoice`;
    const intro = isSub
      ? sub!.sequence === 1
        ? `Pay this first invoice to activate your ${intervalWord} subscription. After that, a fresh invoice is emailed each ${sub!.interval === "ANNUAL" ? "year" : "month"} — just click Pay when it arrives. Cancel anytime.${statementLine}`
        : `This is your ${intervalWord} subscription invoice. Click Pay to keep your subscription active. Cancel anytime.${statementLine}`
      : `Review and pay online in a few clicks. The payment link is unique to this invoice — treat it like a receipt.${statementLine}`;

    // Footer contact — vendor.supportEmail wins over supplierContactEmail
    // in vendor mode (product support goes to the vendor). Rendered as HTML
    // so we can drop a real mailto: link like the handoff template.
    const contactEmail =
      (params.vendor?.supportEmail && params.vendor.supportEmail.trim()) ||
      params.supplierContactEmail ||
      "";
    const contactLink = contactEmail
      ? ` Questions? Reply to this email or write to <a href="mailto:${contactEmail}" style="color:#006AFE;text-decoration:underline;">${contactEmail}</a>.`
      : "";
    const baseFooter = `Sold on hub by ${escapeHtml(params.supplierDisplayName)}.${contactLink}`;
    const subFooterHtml = isSub
      ? ` <a href="${sub!.cancelUrl}" style="color:#6B7280;text-decoration:underline;">Cancel subscription</a>.`
      : "";
    // Marker swap so we don't escape the HTML we just built.
    const footerNoteMarker = isSub ? `${baseFooter} __SUBFOOTER__` : baseFooter;

    rendered = renderVendorInvoiceEmail({
      headline,
      intro,
      detailRows,
      ctaUrl: params.paymentLinkUrl,
      ctaLabel: isSub ? `Pay ${total}` : `Pay ${total}`,
      vendor: {
        name: params.vendor!.name,
        logoUrl: logoAbs,
        brandColor: params.vendor!.brandColor,
        legalName: params.vendor!.legalName,
        licenseText: params.vendor!.licenseText,
      },
      notesHtml,
      footerNote: footerNoteMarker,
    });
    if (isSub) {
      // Replace escaped marker with real link HTML in both channels.
      rendered.html = rendered.html.replace(
        "__SUBFOOTER__",
        subFooterHtml.trim()
      );
      rendered.text = rendered.text.replace(
        "__SUBFOOTER__",
        `Cancel subscription: ${sub!.cancelUrl}`
      );
    }
  } else {
    rendered = renderPoEmail({
      subject,
      headline: `${params.supplierDisplayName} sent you an invoice`,
      intro: `Review and pay online in a few clicks. The payment link is unique to this invoice — treat it like a receipt.`,
      detailRows,
      ctaUrl: params.paymentLinkUrl,
      ctaLabel: `Pay ${total}`,
      ctaColor: brandColor,
      footerNote: params.supplierContactEmail
        ? `Questions? Reply to this email or contact ${params.supplierDisplayName} directly at ${params.supplierContactEmail}.`
        : `Questions? Contact ${params.supplierDisplayName} directly.`,
    });
    // Prepend the supplier's own notes above the standard body when set, so
    // the customer sees any thank-you / terms text the supplier keyed in.
    if (params.notes && params.notes.trim()) {
      const notesEsc = escapeHtml(params.notes.trim());
      const notesHtml = `<div style="background: #fffbeb; border-left: 3px solid ${brandColor}; padding: 12px 16px; margin: 0 0 16px 0; font-size: 13px; color: #4b5563; line-height: 1.5; white-space: pre-line;">${notesEsc}</div>`;
      rendered.html = rendered.html.replace(
        `<p style="color: #4b5563; line-height: 1.6; margin: 0 0 20px 0;">`,
        `${notesHtml}<p style="color: #4b5563; line-height: 1.6; margin: 0 0 20px 0;">`
      );
      rendered.text = `${params.notes.trim()}\n\n${rendered.text}`;
    }
  }

  await sendPoEmail({
    to: params.to,
    cc: params.cc,
    subject,
    // Display label: vendor's name in vendor mode, supplier's own name
    // otherwise. Address still ships from INVOICE_FROM_EMAIL — the label
    // is what the buyer sees ("MegoPay <cloud@synergydatalabs.com>").
    fromLabel: inVendorMode ? params.vendor!.name : params.supplierDisplayName,
    fromEmail: INVOICE_FROM_EMAIL,
    rendered,
  });
}

// ---------------------------------------------------------------------------
// Phase I #3 (2026-09-10) — payment success emails.
//
// sendPaymentReceiptEmail: customer-facing confirmation after a paid card.
// sendPartnerPaymentEmail: opt-in per-link partner notification, to one or
// many addresses stored in supplier_payment_links.notify_emails.
//
// Both are one-shot notifications, so they don't go through the shared
// renderPoEmail helper — a compact inline layout keeps them readable in
// preview panes and mobile inboxes. Fire-and-forget from the caller: any
// SES error is logged, never thrown, so a mail hiccup can't roll back the
// paid state.
// ---------------------------------------------------------------------------

export async function sendPaymentReceiptEmail(params: {
  to: string;
  customerName?: string;
  supplierDisplayName: string;
  invoiceNumber: string;
  totalCents: number;
  currency: string;
  paidAtIso: string;
  brandPrimaryColor?: string;
  invoiceUrl: string;
}): Promise<void> {
  const brand = params.brandPrimaryColor || "#0F766E";
  const total = formatMoney(params.totalCents, params.currency);
  const paidWhen = new Date(params.paidAtIso).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const greeting = params.customerName
    ? `Hi ${escapeHtml(params.customerName)},`
    : "Hi,";
  const subject = `Payment received — ${params.invoiceNumber} — ${total}`;

  const htmlBody = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#F5F7F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px;">
    <div style="background:#ffffff;border-radius:16px;padding:32px;border:1px solid #E5E7EB;">
      <div style="text-align:center;margin-bottom:20px;">
        <div style="display:inline-block;width:56px;height:56px;border-radius:50%;background:${brand};line-height:56px;color:#ffffff;font-size:28px;">&#x2714;</div>
      </div>
      <h1 style="margin:0 0 6px;font-size:22px;color:#111827;text-align:center;">Payment received</h1>
      <p style="margin:0 0 24px;color:#6b7280;text-align:center;font-size:14px;">Thank you for your payment.</p>
      <p style="margin:0 0 16px;color:#374151;font-size:15px;">${greeting}</p>
      <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.5;">
        We&rsquo;ve received your payment of <strong>${escapeHtml(total)}</strong>
        for invoice <strong>${escapeHtml(params.invoiceNumber)}</strong> to
        <strong>${escapeHtml(params.supplierDisplayName)}</strong>.
      </p>
      <table role="presentation" width="100%" style="border-collapse:collapse;margin:0 0 24px;">
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">Invoice</td>
            <td style="padding:8px 0;color:#111827;font-size:13px;text-align:right;font-family:monospace;">${escapeHtml(params.invoiceNumber)}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;border-top:1px solid #F3F4F6;">Amount paid</td>
            <td style="padding:8px 0;color:#111827;font-size:13px;text-align:right;font-weight:600;border-top:1px solid #F3F4F6;">${escapeHtml(total)}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;border-top:1px solid #F3F4F6;">Paid on</td>
            <td style="padding:8px 0;color:#111827;font-size:13px;text-align:right;border-top:1px solid #F3F4F6;">${escapeHtml(paidWhen)}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;border-top:1px solid #F3F4F6;">Method</td>
            <td style="padding:8px 0;color:#111827;font-size:13px;text-align:right;border-top:1px solid #F3F4F6;">Card</td></tr>
      </table>
      <div style="text-align:center;margin:0 0 20px;">
        <a href="${params.invoiceUrl}" style="display:inline-block;padding:10px 20px;background:${brand};color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">View receipt</a>
      </div>
      <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;line-height:1.5;">
        Keep this email as proof of payment. Questions? Reply to this email or contact ${escapeHtml(params.supplierDisplayName)}.
      </p>
    </div>
    <p style="margin:16px 0 0;color:#9ca3af;font-size:11px;text-align:center;">
      Processed securely by Stripe. Card details never touched hub.
    </p>
  </div>
</body></html>`;

  const textBody = `${greeting.replace(/<[^>]+>/g, "")}

We've received your payment of ${total} for invoice ${params.invoiceNumber} to ${params.supplierDisplayName}.

Invoice: ${params.invoiceNumber}
Amount paid: ${total}
Paid on: ${paidWhen}
Method: Card

View receipt: ${params.invoiceUrl}

Keep this email as proof of payment. Processed securely by Stripe.
`;

  try {
    await ses.send(
      new SendEmailCommand({
        Source: `${params.supplierDisplayName} <${INVOICE_FROM_EMAIL}>`,
        Destination: { ToAddresses: [params.to] },
        Message: {
          Subject: { Data: subject, Charset: "UTF-8" },
          Body: {
            Html: { Data: htmlBody, Charset: "UTF-8" },
            Text: { Data: textBody, Charset: "UTF-8" },
          },
        },
      })
    );
  } catch (err) {
    console.error("[sendPaymentReceiptEmail] SES send failed:", err);
  }
}

export async function sendPartnerPaymentEmail(params: {
  to: string[];                 // one or many — de-duped by caller
  linkNickname: string;
  supplierDisplayName: string;
  customerName?: string;
  customerEmail?: string;
  invoiceNumber: string;
  totalCents: number;
  currency: string;
  paidAtIso: string;
  brandPrimaryColor?: string;
}): Promise<void> {
  if (!params.to.length) return;
  const brand = params.brandPrimaryColor || "#0F766E";
  const total = formatMoney(params.totalCents, params.currency);
  const paidWhen = new Date(params.paidAtIso).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const customerLine =
    (params.customerName || params.customerEmail)
      ? `${escapeHtml(params.customerName || "")}${
          params.customerName && params.customerEmail ? " &lt;" : ""
        }${escapeHtml(params.customerEmail || "")}${
          params.customerName && params.customerEmail ? "&gt;" : ""
        }`
      : "—";
  const subject = `Payment received via ${params.linkNickname} — ${total}`;

  const htmlBody = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#F5F7F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px;">
    <div style="background:#ffffff;border-radius:16px;padding:32px;border:1px solid #E5E7EB;">
      <div style="display:inline-block;padding:4px 10px;border-radius:999px;background:${brand}20;color:${brand};font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;">Payment received</div>
      <h1 style="margin:16px 0 6px;font-size:22px;color:#111827;">${escapeHtml(total)}</h1>
      <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">
        A payment came in through your <strong>${escapeHtml(params.linkNickname)}</strong> link.
      </p>
      <table role="presentation" width="100%" style="border-collapse:collapse;margin:0 0 24px;">
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">Invoice</td>
            <td style="padding:8px 0;color:#111827;font-size:13px;text-align:right;font-family:monospace;">${escapeHtml(params.invoiceNumber)}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;border-top:1px solid #F3F4F6;">Customer</td>
            <td style="padding:8px 0;color:#111827;font-size:13px;text-align:right;">${customerLine}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;border-top:1px solid #F3F4F6;">Amount</td>
            <td style="padding:8px 0;color:#111827;font-size:13px;text-align:right;font-weight:600;border-top:1px solid #F3F4F6;">${escapeHtml(total)}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;border-top:1px solid #F3F4F6;">Paid on</td>
            <td style="padding:8px 0;color:#111827;font-size:13px;text-align:right;border-top:1px solid #F3F4F6;">${escapeHtml(paidWhen)}</td></tr>
      </table>
      <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.5;">
        You&rsquo;re receiving this because ${escapeHtml(params.supplierDisplayName)} added your address to
        the notification list for this payment link. To stop these, ask ${escapeHtml(params.supplierDisplayName)}
        to remove your email from the link&rsquo;s settings.
      </p>
    </div>
  </div>
</body></html>`;

  const textBody = `Payment received — ${total}

A payment came in through your ${params.linkNickname} link.

Invoice: ${params.invoiceNumber}
Customer: ${params.customerName || ""} ${params.customerEmail ? `<${params.customerEmail}>` : ""}
Amount: ${total}
Paid on: ${paidWhen}

You're receiving this because ${params.supplierDisplayName} added your address to the notification list for this payment link.
`;

  try {
    await ses.send(
      new SendEmailCommand({
        Source: `${params.supplierDisplayName} <${INVOICE_FROM_EMAIL}>`,
        // BCC so recipients don't see each other. Empty ToAddresses is not
        // permitted; put a dummy in To that echoes the sender address so
        // spam filters don't flag an all-BCC message.
        Destination: {
          ToAddresses: [INVOICE_FROM_EMAIL],
          BccAddresses: params.to,
        },
        Message: {
          Subject: { Data: subject, Charset: "UTF-8" },
          Body: {
            Html: { Data: htmlBody, Charset: "UTF-8" },
            Text: { Data: textBody, Charset: "UTF-8" },
          },
        },
      })
    );
  } catch (err) {
    console.error("[sendPartnerPaymentEmail] SES send failed:", err);
  }
}
