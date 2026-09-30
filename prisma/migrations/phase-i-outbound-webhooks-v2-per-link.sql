-- Phase I #5 v2 (2026-09-14): restructure outbound webhooks from
-- per-tenant to per-payment-link.
--
-- Original design (v1) had ONE tenant-level WebhookEndpoint firing to
-- one URL for every event. That's Stripe-shaped but wrong for Ahmad's
-- use case — each payment link goes to a different partner (Partner A
-- link → Partner A's system, Partner B link → Partner B's system) so
-- each needs its own URL + template. This mirrors TradingView alerts:
-- each alert has its own inline webhook config.
--
-- v1 tables had no data (Phase 3 UI was never used in production), so
-- DROP + recreate is safe. Delivery log gets reshaped to reference the
-- payment link directly rather than a tenant-level endpoint row.

-- Drop v1 tables (no data — no partner ever hit the Settings → Webhooks page)
DROP TABLE IF EXISTS webhook_deliveries;
DROP TABLE IF EXISTS webhook_endpoints;
DROP FUNCTION IF EXISTS webhook_endpoints_touch_updated_at();

-- Add webhook config fields to supplier_payment_links.
-- All nullable / defaulted so existing links keep working as if
-- webhook_enabled=false. The partner opts in by filling webhook_url.
ALTER TABLE supplier_payment_links
  ADD COLUMN webhook_url          VARCHAR(1000),
  ADD COLUMN webhook_secret       VARCHAR(128),
  ADD COLUMN webhook_template     TEXT,
  ADD COLUMN webhook_events       TEXT[]      NOT NULL DEFAULT '{}',
  ADD COLUMN webhook_content_type VARCHAR(60) NOT NULL DEFAULT 'application/json',
  ADD COLUMN webhook_enabled      BOOLEAN     NOT NULL DEFAULT true;

-- Delivery log — reshaped. One row per attempt, references the
-- payment link directly. Cascade on payment link delete so we don't
-- accumulate orphan rows.
CREATE TABLE webhook_deliveries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_link_id UUID          NOT NULL REFERENCES supplier_payment_links(id) ON DELETE CASCADE,
  tenant_id       UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  url             VARCHAR(1000) NOT NULL,
  event_type      VARCHAR(60)   NOT NULL,
  event_id        VARCHAR(40)   NOT NULL,
  request_body    TEXT,
  response_status INT,
  response_body   TEXT,
  duration_ms     INT,
  attempt         INT           NOT NULL DEFAULT 1,
  succeeded       BOOLEAN       NOT NULL DEFAULT false,
  error_message   VARCHAR(500),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX idx_webhook_deliveries_link_created
  ON webhook_deliveries (payment_link_id, created_at DESC);

-- Cross-link lookup (support: "did event evt_abc reach anyone?").
CREATE INDEX idx_webhook_deliveries_event_id
  ON webhook_deliveries (event_id);
