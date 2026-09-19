import type { FrameContext, RenderTemplatePack } from "../template-pack.js";
import { ACCENT, esc, mulberry32 } from "../frame.js";
import { embedImage } from "../image-ops.js";

/**
 * bigtype-hook — the bold hook look: the beat's words explode onto screen
 * one by one in huge type, over a full-bleed product image (darkened,
 * Ken-Burns drift) when a reference image exists, or a punchy accent
 * gradient otherwise. Word timings come from the beat-aligned narration, so
 * the reveal stays anchored to the AdDNA.
 */
export const bigtypeHookPack: RenderTemplatePack = {
  id: "bigtype-hook",
  name: "Big Type Hook (9:16)",
  description: "Huge word-by-word type over a full-bleed product shot.",
  roles: ["hook", "offer", "cta"],
  ui: {
    fields: [
      { key: "impact", label: "Type impact", type: "enum", options: ["bold", "black"], def: "black" },
    ],
  },
  frame(ctx: FrameContext): string {
    const { plan, beat, timeSec: t, progress, images } = ctx;
    const words = beat.segment?.words ?? [];
    const fade = beat.transition === "fade" ? Math.min(1, (t - beat.startSec) / 0.25) : Math.min(1, (t - beat.startSec) / 0.08);
    const introAlpha = Math.max(0, Math.min(1, fade));

    const accent = images[0]?.dominantColor ?? ACCENT;
    const img = images[0];
    const kenX = Math.sin(t * 0.9) * plan.width * 0.012;
    const kenY = Math.cos(t * 0.7) * plan.height * 0.008;
    const zoom = 1.06 + progress * 0.06;

    const background = img
      ? `<g transform="translate(${kenX.toFixed(1)} ${kenY.toFixed(1)}) scale(${zoom.toFixed(3)})">${embedImage(img, { x: -plan.width * 0.03, y: -plan.height * 0.03, w: plan.width * 1.06, h: plan.height * 1.06, blur: 1 }, `bg${beat.index}`)}</g>
         <rect width="${plan.width}" height="${plan.height}" fill="#0e0e0e" opacity="0.62"/>`
      : `<defs><linearGradient id="bth${beat.index}" x1="0" y1="0" x2="0.8" y2="1"><stop offset="0" stop-color="${accent}"/><stop offset="1" stop-color="#101010"/></linearGradient></defs><rect width="${plan.width}" height="${plan.height}" fill="url(#bth${beat.index})"/><ellipse cx="${plan.width * 0.3}" cy="${plan.height * 0.2}" rx="${plan.width * 0.5}" ry="${plan.width * 0.3}" fill="#ffffff" opacity="0.08"/>`;

    // Word-by-word reveal: each word pops when its time comes, the active one jumps.
    const fontSize = Math.round(plan.width * 0.115);
    const perLine = 3;
    const lines: Array<typeof words> = [];
    for (let i = 0; i < words.length; i += perLine) lines.push(words.slice(i, i + perLine));
    const lineHeight = fontSize * 1.3;
    const blockH = lines.length * lineHeight;
    const startY = plan.height * 0.44 - blockH / 2 + fontSize * 0.8;

    // Active word by time — beat word windows are contiguous and non-overlapping.
    let activeWordRef: (typeof words)[number] | undefined = words.find((w) => t >= w.startSec && t < w.endSec);
    if (!activeWordRef && words.length > 0 && t >= words[words.length - 1]!.endSec) {
      activeWordRef = words[words.length - 1];
    }

    const textSvg = lines
      .map((line, li) => {
        const lineWidths = line.map((w) => w.word.length * fontSize * 0.6);
        const total = lineWidths.reduce((a, b) => a + b, 0) + fontSize * 0.3 * (line.length - 1);
        let x = plan.width / 2 - total / 2;
        const y = startY + li * lineHeight;
        const parts = line
          .map((w, wi) => {
            const isActive = w === activeWordRef;
            const appeared = t >= w.startSec - 0.08;
            const pop = isActive ? 1.1 : 1;
            const alpha = appeared ? introAlpha : 0;
            const out = `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="Arial" font-weight="900" font-size="${(fontSize * pop).toFixed(1)}" fill="${isActive ? accent : "#ffffff"}" stroke="#0e0e0e" stroke-width="${(fontSize * 0.04).toFixed(1)}" opacity="${alpha.toFixed(2)}">${esc(w.word.toUpperCase())}</text>`;
            x += (lineWidths[wi] ?? 0) + fontSize * 0.3;
            return out;
          })
          .join("");
        return parts;
      })
      .join("");

    const jitter = mulberry32((plan.seed + beat.index) >>> 0);
    const shake = beat.role === "hook" ? Math.sin(t * 30) * fontSize * 0.012 * jitter() : 0;

    return `${background}
    <g opacity="${introAlpha.toFixed(2)}" transform="translate(${shake.toFixed(1)} 0)">${textSvg}</g>
    <rect x="0" y="${(plan.height - 6).toFixed(1)}" width="${(plan.width * (t / plan.durationSec)).toFixed(1)}" height="6" fill="${accent}" opacity="0.9"/>`;
  },
};
