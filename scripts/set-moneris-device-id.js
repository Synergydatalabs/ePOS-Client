// Usage (on EC2):
//   cd C:\ZASHX-APPs\tap-app
//   node scripts/set-moneris-device-id.js <TENANT_ID> <DEVICE_ID> [IST_CONFIG_CODE]
//
// Example:
//   node scripts/set-moneris-device-id.js <oreugo-tenant-uuid> A7005622
//
// What it does:
//   1. Finds the active Moneris SupplierProcessor row for that tenant
//   2. Decrypts credentials_enc with KYB_ENCRYPTION_KEY from .env.local
//   3. Sets terminal_id (and optionally ist_config_code)
//   4. Re-encrypts and writes back
//
// Safe to re-run. Prints the resulting (redacted) credential summary.

const path = require("path");
const { randomBytes, createCipheriv, createDecipheriv } = require("crypto");
require("dotenv").config({ path: path.join(process.cwd(), ".env.local") });
const { PrismaClient } = require("@prisma/client");

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey() {
  const raw = process.env.KYB_ENCRYPTION_KEY;
  if (!raw) throw new Error("KYB_ENCRYPTION_KEY not set in .env.local");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32)
    throw new Error(`KYB_ENCRYPTION_KEY must be 32 bytes (got ${key.length})`);
  return key;
}

function decryptJson(enc) {
  const buf = Buffer.from(enc, "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const d = createDecipheriv(ALGO, getKey(), iv);
  d.setAuthTag(tag);
  const pt = Buffer.concat([d.update(ct), d.final()]).toString("utf8");
  return JSON.parse(pt);
}

function encryptJson(obj) {
  const iv = randomBytes(IV_LEN);
  const c = createCipheriv(ALGO, getKey(), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

function redact(v) {
  if (!v) return v;
  if (typeof v !== "string") return v;
  if (v.length <= 6) return "***";
  return `${v.slice(0, 3)}…${v.slice(-3)}`;
}

async function main() {
  const [tenantId, deviceId, istConfigCode] = process.argv.slice(2);
  if (!tenantId || !deviceId) {
    console.error(
      "Usage: node scripts/set-moneris-device-id.js <TENANT_ID> <DEVICE_ID> [IST_CONFIG_CODE]"
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const row = await prisma.tenantPaymentProvider.findFirst({
      where: {
        tenantId,
        processor: "MONERIS",
        status: "ACTIVE",
      },
    });
    if (!row) {
      console.error(
        `No ACTIVE Moneris provider found for tenant ${tenantId}. Check tenant id or activate Moneris first.`
      );
      process.exit(2);
    }
    if (!row.credentialsEnc) {
      console.error(`Row ${row.id} has empty credentials_enc.`);
      process.exit(3);
    }

    const creds = decryptJson(row.credentialsEnc);
    const before = { ...creds };
    creds.terminal_id = deviceId;
    if (istConfigCode) creds.ist_config_code = istConfigCode;

    const newEnc = encryptJson(creds);
    await prisma.tenantPaymentProvider.update({
      where: { id: row.id },
      data: { credentialsEnc: newEnc },
    });

    console.log("Updated Moneris provider:");
    console.log("  tenant:         ", tenantId);
    console.log("  provider row:   ", row.id);
    console.log("  store_id:       ", creds.store_id);
    console.log("  api_token:      ", redact(creds.api_token));
    console.log("  terminal_id:    ", creds.terminal_id, before.terminal_id ? `(was ${before.terminal_id})` : "(was empty)");
    console.log("  ist_config_code:", creds.ist_config_code || "(empty)");
    console.log("  environment:    ", creds.environment);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(99);
});
