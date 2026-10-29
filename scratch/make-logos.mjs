// One-off asset generator: turn the provided dark-navy "droo MARKETING" wordmark
// into transparent PNG logo variants for light and dark surfaces.
// Not part of the app build; run manually: node scratch/make-logos.mjs
import sharp from "sharp";

const SRC =
  "C:/Users/ibrah/AppData/Roaming/Qoder/SharedClientCache/cache/images/106fec58/WhatsApp Image 2026-10-29 at 5.39.05 PM-f86910e0.jpg";

// Decode to raw RGBA so we can key out the solid background.
const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({
  resolveWithObject: true,
});
const { width, height, channels } = info;

// Sample the four corners to estimate the background navy colour.
function px(x, y) {
  const i = (y * width + x) * channels;
  return [data[i], data[i + 1], data[i + 2]];
}
const corners = [
  px(2, 2),
  px(width - 3, 2),
  px(2, height - 3),
  px(width - 3, height - 3),
];
const bg = [0, 1, 2].map((c) =>
  Math.round(corners.reduce((s, p) => s + p[c], 0) / corners.length),
);
console.log("estimated background rgb:", bg);

const T_LO = 34; // below this distance -> fully transparent
const T_HI = 96; // above this distance -> fully opaque

function distToBg(r, g, b) {
  return Math.sqrt((r - bg[0]) ** 2 + (g - bg[1]) ** 2 + (b - bg[2]) ** 2);
}
function isWhiteish(r, g, b) {
  return r > 200 && g > 200 && b > 200;
}

// Slate colour used to replace the white wordmark on the light-surface variant.
const SLATE = [30, 41, 59];

const darkBuf = Buffer.alloc(data.length);
const lightBuf = Buffer.alloc(data.length);

for (let i = 0; i < data.length; i += channels) {
  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  const d = distToBg(r, g, b);
  let a;
  if (d <= T_LO) a = 0;
  else if (d >= T_HI) a = 255;
  else a = Math.round(((d - T_LO) / (T_HI - T_LO)) * 255);

  // dark variant: keep original glyph colours
  darkBuf[i] = r;
  darkBuf[i + 1] = g;
  darkBuf[i + 2] = b;
  darkBuf[i + 3] = a;

  // light variant: recolour the white "MARKETING" text to slate so it reads on
  // light backgrounds; keep the saturated gradient untouched.
  if (isWhiteish(r, g, b)) {
    lightBuf[i] = SLATE[0];
    lightBuf[i + 1] = SLATE[1];
    lightBuf[i + 2] = SLATE[2];
  } else {
    lightBuf[i] = r;
    lightBuf[i + 1] = g;
    lightBuf[i + 2] = b;
  }
  lightBuf[i + 3] = a;
}

async function emit(buf, out) {
  await sharp(buf, { raw: { width, height, channels: 4 } })
    .trim({ threshold: 1 })
    .resize({ width: 900 })
    .png()
    .toFile(out);
  const m = await sharp(out).metadata();
  console.log(`wrote ${out} (${m.width}x${m.height})`);
}

await emit(darkBuf, "public/droo-logo.png");
await emit(lightBuf, "public/droo-logo-light.png");
console.log("done");
