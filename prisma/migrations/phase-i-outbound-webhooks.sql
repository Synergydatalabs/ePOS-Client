-- Phase I #5 (2026-09-14): partner-configurable outbound webhooks.
-- Partner tenants define an HTTPS endpoint + a plain-text body template
-- (JSON with {{placeholder}} substitutions, TradingView-style). When a
-- payment event fires we render the template against a context object
-- built from live payment / customer / invoice / tenant data, sign it
-- with HMAC-SHA256, and POST it. Delivery attempts land in the log
-- table so partners can debug "why didn't I get the event."
--
-- Design decisions:
--   * body_template is TEXT — we don't parse or validate its shape;
--     partner owns the schema
--   * events is a Postgres TEXT[] — subscribing to multiple event types
--     is common (payment.succeeded + payment.refunded together)
--   * secret is stored plaintext for now; small blast radius (single
--     tenant's outgoing HMAC key), rotate via the "Regenerate" button
--     in the UI. If we ever centralise secrets, migrate to the same
--     AES-GCM envelope kyb_crypto uses
--   * delivery log gets a monthly partitioned index later if row count
--     grows — start simple, keep the index on (endpoint_id, created_at)

CREATE TABLE webhook_endpoints (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  url           VARCHAR(1000) NOT NULL,
  secret        VARCHAR(128)  NOT NULL,
  events        TEXT[]        NOT NULL DEFAULT '{}',
  body_template TEXT          NOT NULL,
  content_type  VARCHAR(60)   NOT NULL DEFAULT 'application/json',
  enabled       BOOLEAN       NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Fast lookup of live endpoints for a given tenant when firing an event.
CREATE INDEX idx_webhook_endpoints_tenant_enabled
  ON webhook_endpoints (tenant_id)
  WHERE enabled = true;

-- Per-endpoint updated_at trigger. Matches the pattern the other
-- Phase I tables use.
CREATE OR REPLACE FUNCTION webhook_endpoints_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER webhook_endpoints_updated_at
  BEFORE UPDATE ON webhook_endpoints
  FOR EACH ROW EXECUTE FUNCTION webhook_endpoints_touch_updated_at();


CREATE TABLE webhook_deliveries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id     UUID NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_type      VARCHAR(60)  NOT NULL,
  event_id        VARCHAR(40)  NOT NULL,
  request_body    TEXT,
  response_status INT,
  response_body   TEXT,
  duration_ms     INT,
  attempt         INT           NOT NULL DEFAULT 1,
  succeeded       BOOLEAN       NOT NULL DEFAULT false,
  error_message   VARCHAR(500),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Delivery log viewer paginates by (endpoint, most-recent-first).
CREATE INDEX idx_webhook_deliveries_endpoint_created
  ON webhook_deliveries (endpoint_id, created_at DESC);

-- Look up a specific event across all endpoints (useful for support:
-- "did event evt_abc reach anyone?").
CREATE INDEX idx_webhook_deliveries_event_id
  ON webhook_deliveries (event_id);
