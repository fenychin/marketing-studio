import type { RenderTemplatePack, FrameContext } from "../template-pack.js";
import { ACCENT, PALETTES, captionSvg, endCard, productGroup } from "../frame.js";
import { embedImage } from "../image-ops.js";

/**
 * karaoke-uw — the word-anchored vertical narration look, generalized:
 * palette scenes, blurred blobs, Ken-Burns product (real reference image
 * when one is provided, procedural silhouette otherwise), karaoke caption
 * strip with the active word highlighted, accent progress bar, end card on
 * the CTA beat.
 */
export const karaokeUwPack: RenderTemplatePack = {
  id: "karaoke-uw",
  name: "Karaoke Unboxing (9:16)",
  description: "Word-highlighted narration over a softly graded product scene.",
  roles: ["hook", "context", "value", "proof", "offer", "cta"],
  ui: {
    fields: [
      { key: "accent", label: "Accent color", type: "enum", options: ["lime", "cyan", "magenta"], def: "lime" },
    ],
  },
  frame(ctx: FrameContext): string {
    const { plan, beat, timeSec: t, progress, images } = ctx;
    const fade = Math.min(1, (t - beat.startSec) / 0.3, (beat.endSec - t) / 0.3, 1);
    const sceneAlpha = Math.max(0, Math.min(1, fade));
    const [bgA, bgB] = PALETTES[(plan.seed + beat.index) % PALETTES.length]!;
    const globalProgress = t / plan.durationSec;
    const zoom = 1 + 0.05 * globalProgress;
    const bob = Math.sin((t * Math.PI * 2) / 6) * plan.height * 0.008;
    const productOpacity = beat.role === "cta" ? 0.15 : 0.95;

    // Soft light blobs via radial gradients — no per-frame filters (resvg blur is slow).
    const blobs = [0.22, 0.55, 0.8]
      .map((fy, i) => {
        const cx = plan.width * (0.2 + ((plan.seed >> (i * 3)) % 60) / 100);
        const cy = plan.height * fy;
        const rx = plan.width * 0.3;
        return `<defs><radialGradient id="blob${beat.index}_${i}"><stop offset="0" stop-color="#ffffff" stop-opacity="${(0.35 + i * 0.08).toFixed(2)}"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient></defs><ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${(rx * 0.62).toFixed(1)}" fill="url(#blob${beat.index}_${i})"/>`;
      })
      .join("");

    const cx = plan.width / 2;
    const cy = plan.height * 0.44;
    const product = images[0]
      ? `<g transform="translate(${cx.toFixed(1)} ${cy.toFixed(1)}) scale(${zoom.toFixed(3)}) translate(${(-cx).toFixed(1)} ${(-cy).toFixed(1)})">${embedImage(images[0], { x: plan.width * 0.24, y: plan.height * 0.24, w: plan.width * 0.52, h: plan.height * 0.4, radius: plan.width * 0.05, opacity: productOpacity }, `p${beat.index}`)}</g>`
      : `<ellipse cx="${cx.toFixed(1)}" cy="${(plan.height * 0.72 + plan.height * 0.06).toFixed(1)}" rx="${(plan.width * 0.24 * zoom).toFixed(1)}" ry="${(plan.height * 0.02).toFixed(1)}" fill="#000000" opacity="0.16"/><g transform="translate(0 ${bob.toFixed(1)}) scale(1)">${productGroup(plan.seed + beat.index, cx, cy, zoom * 0.9, productOpacity)}</g>`;

    const endCardSvg = beat.role === "cta" && progress > 0.55 ? endCard(plan, Math.min(1, (progress - 0.55) / 0.2)) : "";

    return `<rect width="${plan.width}" height="${plan.height}" fill="url(#g${beat.index % PALETTES.length})"/>
    <defs><linearGradient id="g${beat.index % PALETTES.length}" x1="0" y1="0" x2="0.6" y2="1"><stop offset="0" stop-color="${bgA}"/><stop offset="1" stop-color="${bgB}"/></linearGradient></defs>
    <g opacity="${sceneAlpha.toFixed(2)}">${blobs}</g>
    ${product}
    ${endCardSvg}
    ${captionSvg(plan, t)}
    <rect x="0" y="${(plan.height - 6).toFixed(1)}" width="${(plan.width * globalProgress).toFixed(1)}" height="6" fill="${ACCENT}" opacity="0.9"/>`;
  },
};
