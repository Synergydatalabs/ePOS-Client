// One-shot SVG → JPG converter for Stripe branding uploads.
// Writes JPGs next to the source SVGs in public/images/logo/.

import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const LOGO_DIR = resolve(HERE, "..", "public", "images", "logo");

async function svgToJpg({ src, out, width, height, quality = 95, bg = "#FFFFFF" }) {
  const svgBuf = await readFile(resolve(LOGO_DIR, src));
  const jpg = await sharp(svgBuf, { density: 300 })
    .resize({ width, height, fit: "contain", background: bg })
    .flatten({ background: bg })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
  await writeFile(resolve(LOGO_DIR, out), jpg);
  console.log(`✓ ${out} — ${jpg.length.toLocaleString()} bytes (${width}×${height})`);
}

// Icon — square. Stripe wants ≥128×128 for the icon slot; 512 is generous.
// Background fills to the same teal as the icon square so the corners match.
await svgToJpg({
  src: "hub-icon.svg",
  out: "hub-icon.jpg",
  width: 512,
  height: 512,
  bg: "#0F766E",
});

// Wordmark — rectangular. 800×240 gives comfortable padding around the
// letters on Stripe Checkout's header at every zoom.
await svgToJpg({
  src: "hub-wordmark.svg",
  out: "hub-wordmark.jpg",
  width: 800,
  height: 240,
  bg: "#FFFFFF",
});
