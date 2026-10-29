// One-off: derive square "droo" icon marks (light + dark) from the generated
// wordmark PNGs, for the collapsed sidebar / portal switcher icon variant.
// Run manually: node scratch/make-icons.mjs
import sharp from "sharp";

async function makeIcon(src, out) {
  const md = await sharp(src).metadata();
  const w = md.width;
  const h = md.height;
  // The "MARKETING" band sits in roughly the bottom fifth; keep the droo mark.
  const cropH = Math.round(h * 0.8);
  await sharp(src)
    .extract({ left: 0, top: 0, width: w, height: cropH })
    .trim({ threshold: 1 })
    .resize({ width: 512, height: 512, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(out);
  const m = await sharp(out).metadata();
  console.log(`wrote ${out} (${m.width}x${m.height})`);
}

await makeIcon("public/droo-logo-light.png", "public/droo-icon-light.png");
await makeIcon("public/droo-logo.png", "public/droo-icon-dark.png");
console.log("done");
