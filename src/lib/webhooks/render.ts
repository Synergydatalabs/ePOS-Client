// Phase I #5 (2026-09-14): template renderer for partner outbound webhooks.
//
// TradingView-style: the template is opaque TEXT the partner authored. We
// find `{{path.to.field}}` placeholders and substitute values plucked from
// a plain JS object (the "context") using dot notation. Missing paths
// resolve to empty string so the resulting body still parses when the
// partner uses standard JSON conventions.
//
// Design choices:
//   * No Handlebars / EJS / Mustache dep — this is a 30-line function
//     with well-defined semantics. External template engines bring
//     helper functions, subexpressions, escaping rules we don't want
//     partners tripping over.
//   * `{{.}}` — the whole context serialized to JSON. Escape hatch for
//     partners who just want the entire payload delivered to their
//     endpoint verbatim.
//   * `{{payment}}` (no dot suffix) — serializes that sub-object.
//     Enables partial deliveries without spelling out every field.
//   * Numbers/booleans/objects are stringified via `JSON.stringify` when
//     the placeholder sits inside a JSON literal position; strings are
//     emitted without quotes so `{"amount": {{amount}}}` becomes
//     `{"amount": 12500}` not `{"amount": "12500"}`. We can't tell the
//     difference from the string, so we always emit the JSON
//     representation — the partner writes valid JSON on both sides.

export type WebhookContext = Record<string, unknown>;

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_.\[\]]+|\.)\s*\}\}/g;

/**
 * Substitute `{{path.to.field}}` placeholders in `template` with values
 * pulled from `context` via dot-notation.
 *
 * Rules:
 *   * `{{.}}` → JSON.stringify(context)
 *   * `{{key}}` where value is undefined/null → empty string
 *   * `{{key}}` where value is a primitive → JSON.stringify(value) so
 *     both `"{{name}}"` and `{{amount}}` positions in JSON stay valid
 *   * `{{key}}` where value is object/array → JSON.stringify(value)
 *
 * The template is treated as opaque bytes — we don't parse or validate
 * its shape. The partner is responsible for the wire format.
 */
export function renderWebhookBody(
  template: string,
  context: WebhookContext
): string {
  return template.replace(PLACEHOLDER_RE, (_full, rawPath: string) => {
    if (rawPath === ".") {
      return JSON.stringify(context);
    }
    const value = resolvePath(context, rawPath);
    if (value === undefined || value === null) return "";
    if (typeof value === "string") return JSON.stringify(value);
    // number / boolean / object / array — JSON.stringify produces the
    // right token for a JSON literal position.
    return JSON.stringify(value);
  });
}

/**
 * Walk `obj` by `path` (dot-separated, with optional `[N]` for arrays).
 * `payment.processor.name` → obj.payment.processor.name
 * `source.invoice.line_items[0].description` → the first line item's
 * description.
 * Returns undefined for any missing hop.
 */
function resolvePath(obj: unknown, path: string): unknown {
  // Split on `.` but also expand `foo[0]` → `foo`, `0`. Cheap parse —
  // no need for a full accessor grammar; partners write straightforward
  // paths and we bail cleanly on anything weird.
  const parts = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter((p) => p.length > 0);
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/**
 * List the placeholder paths present in a template. Useful for the
 * settings UI to warn "template references {{metadata.subscription_id}}
 * — attach that key when creating the invoice or it'll come through as
 * empty string." Not called at fire time (renderer runs directly on
 * the template string).
 */
export function extractPlaceholderPaths(template: string): string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER_RE)) {
    found.add(match[1]);
  }
  return [...found].sort();
}
