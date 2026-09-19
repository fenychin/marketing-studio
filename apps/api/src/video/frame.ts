import type { RenderPlan } from "./timeline.js";
import { frameCue, frameScene, activeWordIndex } from "./timeline.js";

/**
 * Frame composer: one SVG per frame. Every visual decision (caption cue,
 * active-word highlight, scene switch, end card) resolves from the word
 * timeline — change the narration timing and the visuals follow.
 */

export const PALETTES: Array<[string, string, string]> = [
  ["#f6d8a8", "#e9a6a0", "#2b2118"],
  ["#d8e6f2", "#9db8d9", "#1c2430"],
  ["#f2d9e6", "#b48ac9", "#2a1e2e"],
  ["#d9f0d5", "#7fb89a", "#182720"],
  ["#e8e6f6", "#8f86c9", "#1e1b30"],
];

export const ACCENT = "#ddf24b";

export function esc(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c] ?? c);
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function productGroup(seed: number, cx: number, cy: number, scale: number, opacity: number): string {
  const rand = mulberry32(seed);
  const [,, ink] = PALETTES[seed % PALETTES.length]!;
  const accent = `hsl(${20 + Math.floor(rand() * 40)} 70% 58%)`;
  const pw = 190 * scale;
  const ph = 340 * scale;
  const type = Math.floor(rand() * 3);
  const g = (body: string) =>
    `<g transform="translate(${cx.toFixed(1)} ${cy.toFixed(1)})" opacity="${opacity.toFixed(2)}">${body}</g>`;
  if (type === 0) {
    return g(`
      <rect x="${-pw * 0.09}" y="${-ph / 2 - pw * 0.14}" width="${pw * 0.18}" height="${pw * 0.16}" rx="${pw * 0.03}" fill="${ink}"/>
      <rect x="${-pw / 2}" y="${-ph / 2}" width="${pw}" height="${ph}" rx="${pw * 0.2}" fill="${accent}"/>
      <rect x="${-pw * 0.3}" y="${-ph * 0.1}" width="${pw * 0.6}" height="${ph * 0.3}" rx="${pw * 0.06}" fill="#ffffff" opacity="0.9"/>`);
  }
  if (type === 1) {
    return g(`
      <rect x="${-pw / 2}" y="${-ph / 2}" width="${pw}" height="${ph}" rx="${pw * 0.14}" fill="${accent}"/>
      <ellipse cx="0" cy="${-ph / 2}" rx="${pw / 2}" ry="${pw * 0.12}" fill="${ink}"/>
      <rect x="${-pw * 0.32}" y="${-ph * 0.05}" width="${pw * 0.64}" height="${ph * 0.28}" rx="${pw * 0.05}" fill="#ffffff" opacity="0.9"/>`);
  }
  return g(`
    <path d="M ${-pw / 2} ${-ph * 0.2} Q 0 ${-ph / 2 - pw * 0.16} ${pw / 2} ${-ph * 0.2} L ${pw / 2} ${ph / 2 - pw * 0.05} Q 0 ${ph / 2 + pw * 0.03} ${-pw / 2} ${ph / 2 - pw * 0.05} Z" fill="${accent}"/>
    <rect x="${-pw * 0.26}" y="${-ph * 0.05}" width="${pw * 0.52}" height="${ph * 0.3}" rx="${pw * 0.05}" fill="#ffffff" opacity="0.88"/>`);
}

export function captionSvg(plan: RenderPlan, timeSec: number): string {
  const cue = frameCue(plan, timeSec);
  if (!cue) return "";
  const fontSize = Math.round(plan.width * 0.062);
  const gap = fontSize * 0.3;
  const widths = cue.words.map((w) => w.word.length * fontSize * 0.68);
  const total = widths.reduce((a, b) => a + b, 0) + gap * (cue.words.length - 1);
  const active = activeWordIndex(cue, timeSec);
  let x = plan.width / 2 - total / 2;
  const baseY = plan.height * 0.84;
  const parts: string[] = [];
  cue.words.forEach((w, i) => {
    const isActive = i === active;
    if (isActive) {
      parts.push(
        `<rect x="${(x - gap / 2).toFixed(1)}" y="${(baseY - fontSize * 0.82).toFixed(1)}" width="${(widths[i]! + gap).toFixed(1)}" height="${(fontSize * 1.18).toFixed(1)}" rx="${(fontSize * 0.3).toFixed(1)}" fill="${ACCENT}"/>`,
      );
    }
    parts.push(
      `<text x="${x.toFixed(1)}" y="${baseY.toFixed(1)}" font-family="Arial" font-weight="800" font-size="${fontSize}" fill="${isActive ? "#111111" : "#ffffff"}" opacity="${isActive ? 1 : 0.85}">${esc(w.word)}</text>`,
    );
    x += widths[i]! + gap;
  });
  return `<g>${parts.join("")}</g>`;
}

export function endCard(plan: RenderPlan, alpha: number): string {
  const fs = Math.round(plan.width * 0.095);
  return `<g opacity="${alpha.toFixed(2)}">
    <text x="${(plan.width / 2).toFixed(1)}" y="${(plan.height * 0.42).toFixed(1)}" text-anchor="middle" font-family="Arial" font-weight="900" font-size="${fs}" fill="#ffffff">READY TO POST</text>
    <rect x="${(plan.width / 2 - plan.width * 0.17).toFixed(1)}" y="${(plan.height * 0.48).toFixed(1)}" width="${(plan.width * 0.34).toFixed(1)}" height="${(plan.height * 0.075).toFixed(1)}" rx="${(plan.height * 0.037).toFixed(1)}" fill="${ACCENT}"/>
    <text x="${(plan.width / 2).toFixed(1)}" y="${(plan.height * 0.48 + plan.height * 0.052).toFixed(1)}" text-anchor="middle" font-family="Arial" font-weight="900" font-size="${Math.round(fs * 0.42)}" fill="#111111">SHOP NOW ✦</text>
  </g>`;
}

export function renderFrameSvg(plan: RenderPlan, frame: number): string {
  const t = frame / plan.fps;
  const scene = frameScene(plan, t);
  const fade = Math.min(1, (t - scene.startSec) / 0.3, (scene.endSec - t) / 0.3, 1);
  const [bgA, bgB] = PALETTES[(plan.seed + scene.index) % PALETTES.length]!;
  const progress = t / plan.durationSec;
  const zoom = 1 + 0.05 * progress;
  const bob = Math.sin((t * Math.PI * 2) / 6) * plan.height * 0.008;
  const productOpacity = scene.kind === "intro" ? fade * 0.95 : scene.kind === "segment" ? 0.95 : 0.15;
  const sceneAlpha = Math.max(0, Math.min(1, fade));

  const blobs = [0.22, 0.55, 0.8]
    .map((fy, i) => {
      const cx = plan.width * (0.2 + ((plan.seed >> (i * 3)) % 60) / 100);
      const cy = plan.height * fy;
      const rx = plan.width * 0.3;
      return `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${(rx * 0.62).toFixed(1)}" fill="#ffffff" opacity="${(0.18 + i * 0.06).toFixed(2)}" filter="url(#soft)"/>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${plan.width}" height="${plan.height}" viewBox="0 0 ${plan.width} ${plan.height}">
  <defs><filter id="soft" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="${(plan.width * 0.06).toFixed(1)}"/></filter></defs>
  <rect width="${plan.width}" height="${plan.height}" fill="url(#g${scene.index % PALETTES.length})"/>
  <defs><linearGradient id="g${scene.index % PALETTES.length}" x1="0" y1="0" x2="0.6" y2="1"><stop offset="0" stop-color="${bgA}"/><stop offset="1" stop-color="${bgB}"/></linearGradient></defs>
  <g opacity="${sceneAlpha.toFixed(2)}">${blobs}</g>
  <ellipse cx="${(plan.width / 2).toFixed(1)}" cy="${(plan.height * 0.72 + plan.height * 0.06).toFixed(1)}" rx="${(plan.width * 0.24 * zoom).toFixed(1)}" ry="${(plan.height * 0.02).toFixed(1)}" fill="#000000" opacity="0.16"/>
  <g transform="translate(0 ${bob.toFixed(1)}) scale(1)">
    ${productGroup(plan.seed + scene.index, plan.width / 2, plan.height * 0.44, zoom * 0.9, productOpacity)}
  </g>
  ${scene.kind === "outro" ? endCard(plan, sceneAlpha) : ""}
  ${captionSvg(plan, t)}
  <rect x="0" y="${(plan.height - 6).toFixed(1)}" width="${(plan.width * progress).toFixed(1)}" height="6" fill="${ACCENT}" opacity="0.9"/>
</svg>`;
}
