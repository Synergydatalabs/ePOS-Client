// Phase I #5 v2 (2026-09-14): outbound webhook dispatcher.
//
// The ONE function payment success paths call: `fireWebhookForLink()`.
// Reads the webhook config off the payment link, renders the template,
// signs + POSTs. Since each link has its own config there's no fan-out
// — one link → one endpoint → one delivery attempt (with retries).
//
// FIRE-AND-FORGET: callers `void fireWebhookForLink(...)` — they never
// await the promise. Payment success must not depend on the partner's
// endpoint being reachable. Every failure lands in webhook_deliveries.

import prisma from "@/lib/prisma";
import {
  buildWebhookContext,
  type BuildContextArgs,
  type WebhookEventType,
} from "./context";
import { renderWebhookBody } from "./render";
import { deliverWebhook } from "./deliver";

export interface FireWebhookForLinkArgs extends BuildContextArgs {
  paymentLinkId: string;
}

/**
 * Emit a webhook for a specific payment link. Callers `void` the promise.
 * Never throws — every failure lands in the delivery log.
 *
 * Skips silently when:
 *   * The link doesn't exist (deleted after invoice was created)
 *   * The link has no webhookUrl configured
 *   * webhookEnabled = false
 *   * The link's webhookEvents doesn't include this eventType
 */
export async function fireWebhookForLink(
  args: FireWebhookForLinkArgs
): Promise<void> {
  try {
    const link = await prisma.supplierPaymentLink.findUnique({
      where: { id: args.paymentLinkId },
      select: {
        id: true,
        supplierTenantId: true,
        webhookUrl: true,
        webhookSecret: true,
        webhookTemplate: true,
        webhookEvents: true,
        webhookContentType: true,
        webhookEnabled: true,
      },
    });
    if (!link) return;
    if (!link.webhookEnabled) return;
    // Phase I #5 v3 (2026-09-14): secret is now optional (partner may
    // rely on URL-embedded token instead of HMAC). URL + template are
    // still required.
    if (!link.webhookUrl || !link.webhookTemplate) return;
    if (!link.webhookEvents.includes(args.eventType)) return;

    const context = buildWebhookContext({
      ...args,
      webhookSecret: link.webhookSecret,
    });
    const eventId = String((context.event as Record<string, unknown>).id);
    const rendered = renderWebhookBody(link.webhookTemplate, context);

    await deliverWebhook({
      paymentLinkId: link.id,
      tenantId: link.supplierTenantId,
      url: link.webhookUrl,
      secret: link.webhookSecret,
      contentType: link.webhookContentType,
      eventType: args.eventType,
      eventId,
      body: rendered,
    });
  } catch (err) {
    console.error(
      `[webhooks] dispatch failed for link ${args.paymentLinkId} event ${args.eventType}:`,
      err
    );
  }
}

export type { WebhookEventType };
