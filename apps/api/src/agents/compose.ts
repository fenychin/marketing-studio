import type { PacingModel } from "./analyze.js";

/**
 * Workflow composer — the "Agent" that turns reference rhythm + product info
 * into an ad script. Two implementations behind one interface:
 *  - LlmComposer: OpenAI-compatible chat completions (STUDIO_LLM_* env), with
 *    automatic fallback to the rule composer on any failure.
 *  - RuleComposer: deterministic structure-preserving rewrite — matches the
 *    reference's beat count and per-beat word rhythm without any network.
 */

export interface ProductInfo {
  name: string;
  description?: string;
  price?: string;
  url?: string;
}

export interface ComposeInput {
  pacing: PacingModel;
  product: ProductInfo;
  transcript?: string | null;
  tone?: string;
}

export interface ComposedScript {
  script: string;
  composer: "llm" | "rule";
  beats: string[];
}

const TONES = {
  energetic: {
    hook: (p: ProductInfo) => `Stop scrolling — ${p.name} is about to replace everything on your shelf.`,
    value: (p: ProductInfo) => `${firstClause(p.description) ?? "Built for real life"} — that is what ${p.name} delivers.`,
    cta: (p: ProductInfo) => `Get ${p.name} today — link in bio.`,
  },
  premium: {
    hook: (p: ProductInfo) => `${p.name}. Quiet luxury, loud results.`,
    value: (p: ProductInfo) => `${firstClause(p.description) ?? "Crafted without compromise"} — the new standard from ${p.name}.`,
    cta: (p: ProductInfo) => `Discover ${p.name} — limited release.`,
  },
  friendly: {
    hook: (p: ProductInfo) => `Okay, ${p.name} might be my favorite find this month.`,
    value: (p: ProductInfo) => `${firstClause(p.description) ?? "It simply works"} — no filters needed.`,
    cta: (p: ProductInfo) => `Grab yours before it sells out.`,
  },
} as const;

/**
 * Grammar-safe rhythm matching: each beat role has short/medium/long
 * variants; the variant whose word count is closest to the reference beat
 * wins. Sentences are never spliced mid-way.
 */
const VARIANTS: Record<string, Record<"hook" | "value" | "cta", Array<(p: ProductInfo) => string>>> = {
  energetic: {
    hook: [
      (p) => `${p.name}. Game over.`,
      (p) => `Stop scrolling — ${p.name} just changed the game.`,
      (p) => `Stop scrolling right now, because ${p.name} is about to replace everything else on your shelf.`,
    ],
    value: [
      (p) => `${firstClause(p.description) ?? "Built for real life"}.`,
      (p) => `${firstClause(p.description) ?? "Built for real life"} — and it shows from day one.`,
      (p) => `${firstClause(p.description) ?? "Built for real life"} — and once you try ${p.name}, there is honestly no going back.`,
    ],
    cta: [
      (p) => `Get ${p.name} now.`,
      (p) => `Get ${p.name} today — link in bio.`,
      (p) => `Tap the link and get ${p.name} today, before this launch price disappears.`,
    ],
  },
  premium: {
    hook: [
      (p) => `${p.name}. Refined.`,
      (p) => `${p.name}. Quiet luxury, loud results.`,
      (p) => `${p.name} — a quiet kind of luxury that delivers remarkably loud results, every single time.`,
    ],
    value: [
      (p) => `${firstClause(p.description) ?? "Crafted without compromise"}.`,
      (p) => `${firstClause(p.description) ?? "Crafted without compromise"} — the new standard.`,
      (p) => `${firstClause(p.description) ?? "Crafted without compromise"} — this is the new standard, and ${p.name} wears it effortlessly.`,
    ],
    cta: [
      (p) => `Discover ${p.name}.`,
      (p) => `Discover ${p.name} — limited release.`,
      (p) => `Discover ${p.name} today, exclusively while this limited release remains available.`,
    ],
  },
  friendly: {
    hook: [
      (p) => `Okay, ${p.name} is my new obsession.`,
      (p) => `Okay, ${p.name} might be my favorite find this month.`,
      (p) => `Okay, hear me out — ${p.name} might be the best thing I have found all month, hands down.`,
    ],
    value: [
      (p) => `${firstClause(p.description) ?? "It simply works"}.`,
      (p) => `${firstClause(p.description) ?? "It simply works"} — no filters needed.`,
      (p) => `${firstClause(p.description) ?? "It simply works"} — I have used it for weeks and it still makes me smile every single day.`,
    ],
    cta: [
      (p) => `Grab ${p.name} now.`,
      (p) => `Grab yours before it sells out, seriously.`,
      (p) => `If you want one, grab it now — this one will not stay in stock for long, promise.`,
    ],
  },
};

function firstClause(description?: string): string | undefined {
  const clause = description?.split(/[.。!!??]/).map((s) => s.trim()).filter(Boolean)[0];
  return clause ? clause.charAt(0).toUpperCase() + clause.slice(1) : undefined;
}

function pickTone(tone?: string): keyof typeof TONES {
  return (tone && tone in TONES ? tone : "energetic") as keyof typeof TONES;
}

export async function composeScript(input: ComposeInput): Promise<ComposedScript> {
  if (process.env.STUDIO_LLM_BASE_URL && process.env.STUDIO_LLM_API_KEY) {
    try {
      return await llmCompose(input);
    } catch {
      // fall through to the deterministic composer
    }
  }
  return ruleCompose(input);
}

/** Structure-preserving rewrite: beat count from pacing, per-beat word rhythm from the transcript. */
export function ruleCompose(input: ComposeInput): ComposedScript {
  const { pacing, product } = input;
  const toneKey = pickTone(input.tone);
  const variants = VARIANTS[toneKey];
  const roles: Array<"hook" | "value" | "cta"> =
    pacing.segmentCount <= 2 ? ["hook", "cta"] : ["hook", ...Array<"value">(pacing.segmentCount - 2).fill("value"), "cta"];

  const refBeats = input.transcript?.split(/[.。!!??]+/).map((s) => s.trim()).filter(Boolean) ?? [];
  const beats = roles.map((role, i) => {
    const target = refBeats[i]?.split(/\s+/).length ?? 10;
    let best = variants[role][0]!(product);
    let bestDelta = Infinity;
    for (const make of variants[role]) {
      const candidate = make(product);
      const delta = Math.abs(candidate.split(/\s+/).length - target);
      if (delta < bestDelta) {
        best = candidate;
        bestDelta = delta;
      }
    }
    return best;
  });

  return { script: beats.join(" "), composer: "rule", beats };
}

async function llmCompose(input: ComposeInput): Promise<ComposedScript> {
  const baseUrl = process.env.STUDIO_LLM_BASE_URL!.replace(/\/$/, "");
  const apiKey = process.env.STUDIO_LLM_API_KEY!;
  const model = process.env.STUDIO_LLM_MODEL ?? "gpt-4o-mini";
  const system =
    "You are a short-form ad scriptwriter. Given a reference ad's pacing and an optional transcript, " +
    "write a vertical ad script for the given product. Match the reference beat count and per-beat " +
    "length. Return ONLY the script — plain sentences, no numbering, no markdown.";
  const user = [
    `Reference: ${input.pacing.segmentCount} beats, ${input.pacing.durationSec.toFixed(1)}s total.`,
    input.transcript ? `Reference transcript: ${input.transcript}` : "No transcript available — keep the same rhythm.",
    `Product: ${input.product.name}`,
    input.product.description ? `Product details: ${input.product.description}` : "",
    input.tone ? `Tone: ${input.tone}` : "",
  ].filter(Boolean).join("\n");

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.8,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`llm ${response.status}`);
  const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = body.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("empty llm response");
  const beats = content.split(/(?<=[.!?])\s+/).filter(Boolean);
  return { script: beats.join(" "), composer: "llm", beats };
}
