/**
 * Deterministic programmatic art used by the mock provider and the
 * placeholder route. All demo visuals in the product are generated here —
 * no third-party imagery is bundled.
 */

export interface ArtOptions {
  seed: number;
  width: number;
  height: number;
  label?: string;
  kind?: "image" | "video";
  animate?: boolean;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c] ?? c,
  );
}

const PALETTES: Array<[string, string, string]> = [
  ["#f6d8a8", "#e9a6a0", "#2b2118"],
  ["#d8e6f2", "#9db8d9", "#1c2430"],
  ["#f2d9e6", "#b48ac9", "#2a1e2e"],
  ["#d9f0d5", "#7fb89a", "#182720"],
  ["#f6e3c5", "#d98a5f", "#2d1c12"],
  ["#e8e6f6", "#8f86c9", "#1e1b30"],
  ["#f9d9c0", "#e2694f", "#301410"],
  ["#cfe8ef", "#5fa8b8", "#122428"],
];

export function placeholderSvg(opts: ArtOptions): string {
  const { seed, width: w, height: h, kind = "image", animate = false } = opts;
  const rand = mulberry32(seed);
  const [bgA, bgB, ink] = PALETTES[Math.floor(rand() * PALETTES.length)] ?? PALETTES[0];
  const hueShift = Math.floor(rand() * 40) - 20;

  const label = escapeXml((opts.label ?? "PRODUCT").toUpperCase().slice(0, 18));
  const blobCount = 2 + Math.floor(rand() * 2);
  let blobs = "";
  for (let i = 0; i < blobCount; i++) {
    const cx = w * (0.15 + rand() * 0.7);
    const cy = h * (0.12 + rand() * 0.35);
    const rx = w * (0.18 + rand() * 0.25);
    const ry = rx * (0.5 + rand() * 0.6);
    const op = 0.25 + rand() * 0.3;
    const anim = animate
      ? `<animate attributeName="cx" values="${cx};${cx + w * 0.08};${cx}" dur="${6 + rand() * 6}s" repeatCount="indefinite"/>`
      : "";
    blobs += `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" fill="#ffffff" opacity="${op.toFixed(2)}" filter="url(#soft)">${anim}</ellipse>`;
  }

  // Product: bottle / can / pouch silhouette chosen by seed.
  const productType = Math.floor(rand() * 3);
  const pw = w * (0.2 + rand() * 0.08);
  const ph = h * (0.34 + rand() * 0.12);
  const px = w / 2;
  const py = h * 0.68;
  const accent = `hsl(${(25 + hueShift + 360) % 360} 70% 58%)`;
  let product = "";
  if (productType === 0) {
    product = `
      <rect x="${(px - pw * 0.18).toFixed(1)}" y="${(py - ph - pw * 0.28).toFixed(1)}" width="${(pw * 0.36).toFixed(1)}" height="${(pw * 0.3).toFixed(1)}" rx="${(pw * 0.06).toFixed(1)}" fill="${ink}"/>
      <rect x="${(px - pw / 2).toFixed(1)}" y="${(py - ph).toFixed(1)}" width="${pw.toFixed(1)}" height="${ph.toFixed(1)}" rx="${(pw * 0.22).toFixed(1)}" fill="${accent}"/>
      <rect x="${(px - pw * 0.3).toFixed(1)}" y="${(py - ph * 0.62).toFixed(1)}" width="${(pw * 0.6).toFixed(1)}" height="${(ph * 0.3).toFixed(1)}" rx="${(pw * 0.06).toFixed(1)}" fill="#ffffff" opacity="0.85"/>`;
  } else if (productType === 1) {
    product = `
      <rect x="${(px - pw / 2).toFixed(1)}" y="${(py - ph).toFixed(1)}" width="${pw.toFixed(1)}" height="${ph.toFixed(1)}" rx="${(pw * 0.16).toFixed(1)}" fill="${accent}"/>
      <ellipse cx="${px.toFixed(1)}" cy="${(py - ph).toFixed(1)}" rx="${(pw / 2).toFixed(1)}" ry="${(pw * 0.14).toFixed(1)}" fill="${ink}"/>
      <rect x="${(px - pw * 0.32).toFixed(1)}" y="${(py - ph * 0.55).toFixed(1)}" width="${(pw * 0.64).toFixed(1)}" height="${(ph * 0.28).toFixed(1)}" rx="${(pw * 0.05).toFixed(1)}" fill="#ffffff" opacity="0.88"/>`;
  } else {
    product = `
      <path d="M ${(px - pw / 2).toFixed(1)} ${(py - ph * 0.72).toFixed(1)}
               Q ${px.toFixed(1)} ${(py - ph * 1.02).toFixed(1)} ${(px + pw / 2).toFixed(1)} ${(py - ph * 0.72).toFixed(1)}
               L ${(px + pw / 2).toFixed(1)} ${(py - ph * 0.1).toFixed(1)}
               Q ${px.toFixed(1)} ${(py - ph * 0.02).toFixed(1)} ${(px - pw / 2).toFixed(1)} ${(py - ph * 0.1).toFixed(1)} Z"
            fill="${accent}"/>
      <rect x="${(px - pw * 0.26).toFixed(1)}" y="${(py - ph * 0.55).toFixed(1)}" width="${(pw * 0.52).toFixed(1)}" height="${(ph * 0.3).toFixed(1)}" rx="${(pw * 0.05).toFixed(1)}" fill="#ffffff" opacity="0.85"/>`;
  }
  const anim = animate
    ? `<ellipse cx="${w * 0.3}" cy="${h * 0.25}" rx="${w * 0.12}" ry="${h * 0.05}" fill="#ffffff" opacity="0.5">
         <animate attributeName="cx" values="${w * 0.2};${w * 0.8};${w * 0.2}" dur="7s" repeatCount="indefinite"/>
         <animate attributeName="opacity" values="0.15;0.5;0.15" dur="7s" repeatCount="indefinite"/>
       </ellipse>`
    : "";

  const chip =
    kind === "video"
      ? `<g><rect x="${w - 92}" y="16" width="76" height="26" rx="13" fill="#000000" opacity="0.65"/>
         <text x="${w - 54}" y="33" font-family="Arial, sans-serif" font-size="12" font-weight="700" fill="#ffffff" text-anchor="middle" letter-spacing="1">MOTION</text></g>`
      : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.7" y2="1">
      <stop offset="0" stop-color="${bgA}"/><stop offset="1" stop-color="${bgB}"/>
    </linearGradient>
    <filter id="soft" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="${(w * 0.05).toFixed(1)}"/></filter>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  ${blobs}
  <ellipse cx="${w / 2}" cy="${(py + ph * 0.06).toFixed(1)}" rx="${(pw * 0.9).toFixed(1)}" ry="${(h * 0.025).toFixed(1)}" fill="#000000" opacity="0.18"/>
  ${product}
  ${anim}
  ${chip}
  <text x="${w / 2}" y="${h - 22}" font-family="Arial, sans-serif" font-size="${Math.max(12, Math.round(w * 0.035))}" font-weight="800" fill="${ink}" opacity="0.75" text-anchor="middle" letter-spacing="3">${label}</text>
</svg>`;
}

export function aspectSize(aspect: string, base = 1024): { width: number; height: number } {
  const [a, b] = aspect.split(":").map(Number);
  if (!a || !b) return { width: base, height: base };
  const ratio = a / b;
  return ratio >= 1
    ? { width: base, height: Math.round(base / ratio) }
    : { width: Math.round(base * ratio), height: base };
}

export function svgBuffer(svg: string): Buffer {
  return Buffer.from(svg, "utf8");
}
