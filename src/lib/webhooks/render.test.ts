// Phase I #5 (2026-09-14): render.ts sanity checks.
// Not part of a formal test suite (tap-app doesn't run jest in CI yet)
// — run manually with `npx tsx src/lib/webhooks/render.test.ts` when
// touching the renderer. Prints "PASS" / "FAIL" per case + exits 1 on
// any failure so it can be wired into CI later.

import { renderWebhookBody, extractPlaceholderPaths } from "./render";

interface Case {
  name: string;
  template: string;
  context: Record<string, unknown>;
  expect: string;
}

const context = {
  event: { type: "payment.succeeded", id: "evt_abc" },
  payment: { amount: 12500, currency: "cad", paid_at: "2026-09-14T15:22:18Z" },
  customer: { email: "jane@example.com", name: "Jane Doe" },
  metadata: { subscription_id: "sub_123", tier: "pro" },
  source: {
    invoice: {
      line_items: [
        { description: "Pro plan", amount: 10000 },
        { description: "Extra seats", amount: 2500 },
      ],
    },
  },
};

const cases: Case[] = [
  {
    name: "string placeholder emits JSON-quoted string",
    template: `{"email": {{customer.email}}}`,
    context,
    expect: `{"email": "jane@example.com"}`,
  },
  {
    name: "number placeholder emits raw number (JSON-safe)",
    template: `{"amount": {{payment.amount}}}`,
    context,
    expect: `{"amount": 12500}`,
  },
  {
    name: "missing path emits empty string",
    template: `{"note": {{missing.field}}}`,
    context,
    expect: `{"note": }`,
  },
  {
    name: "nested metadata access",
    template: `{"sub": {{metadata.subscription_id}}}`,
    context,
    expect: `{"sub": "sub_123"}`,
  },
  {
    name: "array index into line_items",
    template: `{"first": {{source.invoice.line_items[0].description}}}`,
    context,
    expect: `{"first": "Pro plan"}`,
  },
  {
    name: "sub-object serializes to JSON",
    template: `{"customer": {{customer}}}`,
    context,
    expect: `{"customer": {"email":"jane@example.com","name":"Jane Doe"}}`,
  },
  {
    name: "whole context via {{.}}",
    template: `{{.}}`,
    context: { a: 1, b: "two" },
    expect: `{"a":1,"b":"two"}`,
  },
  {
    name: "whitespace inside braces is tolerated",
    template: `{{ payment.currency }}`,
    context,
    expect: `"cad"`,
  },
  {
    name: "static text passes through unchanged",
    template: `hello world`,
    context,
    expect: `hello world`,
  },
  {
    name: "multiple placeholders in same template",
    template: `Payment of {{payment.amount}} from {{customer.email}}`,
    context,
    expect: `Payment of 12500 from "jane@example.com"`,
  },
];

let failed = 0;
for (const c of cases) {
  const got = renderWebhookBody(c.template, c.context);
  if (got === c.expect) {
    console.log(`PASS  ${c.name}`);
  } else {
    console.log(`FAIL  ${c.name}`);
    console.log(`  expected: ${JSON.stringify(c.expect)}`);
    console.log(`  got:      ${JSON.stringify(got)}`);
    failed += 1;
  }
}

// extractPlaceholderPaths sanity check
const paths = extractPlaceholderPaths(
  `{"a": {{customer.email}}, "b": {{payment.amount}}, "c": {{metadata.tier}}, "d": {{customer.email}}}`
);
const expectedPaths = ["customer.email", "metadata.tier", "payment.amount"];
const pathsOk =
  paths.length === expectedPaths.length &&
  paths.every((p, i) => p === expectedPaths[i]);
if (pathsOk) {
  console.log("PASS  extractPlaceholderPaths dedupes + sorts");
} else {
  console.log("FAIL  extractPlaceholderPaths dedupes + sorts");
  console.log(`  expected: ${JSON.stringify(expectedPaths)}`);
  console.log(`  got:      ${JSON.stringify(paths)}`);
  failed += 1;
}

if (failed > 0) {
  console.log(`\n${failed} case(s) failed`);
  process.exit(1);
} else {
  console.log(`\nAll ${cases.length + 1} cases passed`);
}
