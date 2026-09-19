import type { AdDNA, AdDNABeat, BeatRole } from "@studio/shared";
import { countTextUnits } from "./dna.js";
import { firstClause, type ProductInfo } from "./compose.js";

/**
 * Per-beat script rewriter — turns an AdDNA + product into a script where
 * every beat lands inside its word-count window (the energy contract).
 *
 * Two implementations behind one orchestrator:
 *  - LLM path: the model receives hard per-beat constraints and must answer
 *    with a JSON beat array; a pure accept/reject validator enforces beat
 *    count and windows. One retry, then the rule path takes over — the
 *    rhythm replica never depends on the network.
 *  - Rule path: deterministic, structure-preserving templates. 6 roles ×
 *    3 tones × 3 lengths per language; the variant whose unit count is
 *    closest to the window midpoint wins. Slower copy, exact structure.
 */

export type AdLanguage = "zh" | "en";

export interface RewriteInput {
  dna: AdDNA;
  product: ProductInfo;
  tone?: string;
  language?: "auto" | AdLanguage;
}

export interface BeatScript {
  index: number;
  role: BeatRole;
  text: string;
  units: number;
  inWindow: boolean;
}

export interface RewriteResult {
  script: string;
  beats: BeatScript[];
  composer: "llm" | "rule";
  language: AdLanguage;
  /** Share of beats whose unit count landed inside the window (0–1). */
  energyMatch: number;
}

type Make = (p: ProductInfo) => string;
type Tone = "energetic" | "premium" | "friendly";

const TONES: readonly Tone[] = ["energetic", "premium", "friendly"];

function normalizeTone(tone?: string): Tone {
  return TONES.includes(tone as Tone) ? (tone as Tone) : "energetic";
}

// ---------------------------------------------------------------------------
// Rule composer — self-written template grammar, EN + ZH
// ---------------------------------------------------------------------------

const n = (p: ProductInfo): string => p.name;
const d = (p: ProductInfo, fallback: string): string => firstClause(p.description) ?? fallback;
const at = (p: ProductInfo, fallback: string): string => p.price ?? fallback;

const EN: Record<Tone, Record<BeatRole, Make[]>> = {
  energetic: {
    hook: [
      (p) => `Stop scrolling — ${n(p)}.`,
      (p) => `Stop scrolling right now, because ${n(p)} just changed everything.`,
      (p) => `Stop scrolling right now, because ${n(p)} is about to replace every single product on your shelf.`,
    ],
    context: [
      () => `Everyone gets this wrong.`,
      (p) => `You have been let down by everything else you tried before ${n(p)}.`,
      (p) => `You have been let down by every alternative you tried, and deep down you knew there had to be something better than the usual shelf fillers.`,
    ],
    value: [
      (p) => `${d(p, "It simply works")}.`,
      (p) => `${d(p, "Built for real life")} — and it shows from day one.`,
      (p) => `${d(p, "Built for real life")} — and once you try ${n(p)}, there is honestly no going back.`,
    ],
    proof: [
      () => `Thousands already swear by it.`,
      (p) => `Thousands already swear by ${n(p)}, and the reviews speak for themselves.`,
      (p) => `Thousands of customers already swear by ${n(p)}, and their five-star reviews speak louder than any ad ever could.`,
    ],
    offer: [
      (p) => `Now at ${at(p, "a launch price")}.`,
      (p) => `Right now ${n(p)} is just ${at(p, "a launch price")} — but not for long.`,
      (p) => `Right now you can get ${n(p)} for only ${at(p, "our launch price")}, and honestly, at a price like this it will not stay in stock for long.`,
    ],
    cta: [
      (p) => `Get ${n(p)} now.`,
      (p) => `Get ${n(p)} today — link in bio.`,
      (p) => `Tap the link and get ${n(p)} today, before this launch price disappears for good.`,
    ],
  },
  premium: {
    hook: [
      (p) => `${n(p)}. Refined.`,
      (p) => `${n(p)} — quiet luxury, loud results.`,
      (p) => `${n(p)} — a quiet kind of luxury that delivers remarkably loud results, every single time.`,
    ],
    context: [
      () => `Crafted without compromise.`,
      (p) => `Most products cut corners. ${n(p)} does not.`,
      (p) => `Most products cut corners to hit a price point; ${n(p)} was engineered without a single compromise.`,
    ],
    value: [
      (p) => `${d(p, "Crafted without compromise")}.`,
      (p) => `${d(p, "Crafted without compromise")} — the new standard from ${n(p)}.`,
      (p) => `${d(p, "Crafted without compromise")} — this is the new standard, and ${n(p)} wears it effortlessly.`,
    ],
    proof: [
      () => `Loved by critics.`,
      (p) => `Rated five stars by the people who matter most — the owners of ${n(p)}.`,
      (p) => `Rated five stars by the people who matter most, the owners who live with ${n(p)} every single day.`,
    ],
    offer: [
      () => `Limited release.`,
      (p) => `The limited release of ${n(p)} is available now.`,
      (p) => `The first limited release of ${n(p)} is available today, and once it is gone, it is gone for good.`,
    ],
    cta: [
      (p) => `Discover ${n(p)}.`,
      (p) => `Discover ${n(p)} — limited release.`,
      (p) => `Discover ${n(p)} today, exclusively while this limited release remains available.`,
    ],
  },
  friendly: {
    hook: [
      (p) => `Okay, ${n(p)} is a find.`,
      (p) => `Okay, ${n(p)} might be my favorite find this month.`,
      (p) => `Okay, hear me out — ${n(p)} might be the best thing I have found all month, hands down.`,
    ],
    context: [
      () => `I was skeptical too.`,
      () => `I was skeptical too, until I actually tried it.`,
      (p) => `I was skeptical too, until I spent a full week using ${n(p)} every single day.`,
    ],
    value: [
      (p) => `${d(p, "It simply works")}.`,
      (p) => `${d(p, "It simply works")} — no filters needed.`,
      (p) => `${d(p, "It simply works")} — I have used it for weeks and it still makes me smile every single day.`,
    ],
    proof: [
      () => `My friends all asked about it.`,
      (p) => `Every friend who visited asked where I got ${n(p)}.`,
      (p) => `Every single friend who visited my place asked where I got ${n(p)}, and that says everything.`,
    ],
    offer: [
      () => `Good news — it is affordable.`,
      () => `And the price is honestly a steal right now.`,
      () => `And the best part — the price is honestly a steal right now, so this is the moment to grab one.`,
    ],
    cta: [
      (p) => `Grab yours soon.`,
      () => `Grab yours before it sells out, seriously.`,
      () => `If you want one, grab it now — this one will not stay in stock for long, promise.`,
    ],
  },
};

const ZH: Record<Tone, Record<BeatRole, Make[]>> = {
  energetic: {
    hook: [
      (p) => `别划走，${n(p)}。`,
      (p) => `先别划走，${n(p)}把这件事彻底改变了。`,
      (p) => `先别划走，因为你身边的货架上，${n(p)}马上要取代其他所有同类产品。`,
    ],
    context: [
      () => `这一点很多人都做错了。`,
      () => `这一点大多数人都做错了，你值得更好的选择。`,
      (p) => `这一点大多数人都做错了，其实你一直值得一个更好的选择，只是还没遇到${n(p)}。`,
    ],
    value: [
      (p) => `${d(p, "它真的好用")}。`,
      (p) => `${d(p, "为真实生活而造")}，而且第一天就能感受到。`,
      (p) => `${d(p, "为真实生活而造")}，而且只要你用过${n(p)}，就真的回不去了。`,
    ],
    proof: [
      () => `无数人已经回购。`,
      () => `无数人已经回购，好评看得见。`,
      () => `无数人已经下单回购，清一色的好评，比任何广告都更有说服力。`,
    ],
    offer: [
      (p) => `现在只要${at(p, "上新价")}。`,
      (p) => `现在${n(p)}只要${at(p, "上新价")}，但不会太久。`,
      (p) => `现在下单${n(p)}只要${at(p, "上新价")}，说实话这个价格，库存真的撑不了多久。`,
    ],
    cta: [
      (p) => `马上带走${n(p)}。`,
      (p) => `今天就入手${n(p)}，链接就在下面。`,
      (p) => `点下方链接马上带走${n(p)}，趁这个上新价还在，别再犹豫了。`,
    ],
  },
  premium: {
    hook: [
      (p) => `${n(p)}，低调有度。`,
      (p) => `${n(p)}，安静的奢华，响亮的结果。`,
      (p) => `${n(p)}，一种安静的奢华，却在每一次使用里交出足够响亮的成绩。`,
    ],
    context: [
      () => `真正的精品，从不妥协。`,
      (p) => `多数产品都在偷工减料，${n(p)}没有。`,
      (p) => `大多数产品为了控制成本都在偷工减料，而${n(p)}在每一处细节上都毫不妥协。`,
    ],
    value: [
      (p) => `${d(p, "匠心打磨")}。`,
      (p) => `${d(p, "匠心打磨")}，这是${n(p)}给出的新标准。`,
      (p) => `${d(p, "匠心打磨")}，这就是新的标准，而${n(p)}举重若轻。`,
    ],
    proof: [
      () => `口碑之选。`,
      () => `真正懂它的人，给出了满分评价。`,
      (p) => `真正懂它的用户给出了清一色的满分评价，他们每一天都在使用${n(p)}。`,
    ],
    offer: [
      () => `限量发售。`,
      (p) => `${n(p)}首批限量版，现已开启。`,
      (p) => `${n(p)}的首批限量版今日开启，售完即止，不再补货。`,
    ],
    cta: [
      (p) => `了解${n(p)}。`,
      (p) => `即刻了解${n(p)}，限量发售。`,
      (p) => `即刻拥有${n(p)}，仅限本次限量发售期间。`,
    ],
  },
  friendly: {
    hook: [
      (p) => `说实话，${n(p)}绝了。`,
      (p) => `说实话，${n(p)}可能是我这个月最喜欢的发现。`,
      (p) => `说真的，听我一句，${n(p)}大概是我这个月淘到的最好的东西，没有之一。`,
    ],
    context: [
      () => `我一开始也不信。`,
      () => `我一开始也不信，直到真的用了。`,
      (p) => `我一开始也不信，直到用${n(p)}整整过了一周，每天都被它惊艳。`,
    ],
    value: [
      (p) => `${d(p, "它就是好用")}。`,
      (p) => `${d(p, "它就是好用")}，完全不需要滤镜。`,
      (p) => `${d(p, "它就是好用")}，我用了好几周，到现在每天看到它还是会心情很好。`,
    ],
    proof: [
      () => `朋友都在问链接。`,
      (p) => `来我家的朋友，个个都问${n(p)}在哪买的。`,
      (p) => `每一个来我家的朋友都追着问${n(p)}在哪买的，这一句就够了。`,
    ],
    offer: [
      () => `而且价格很香。`,
      () => `重点是，现在这个价格真的很香。`,
      () => `最棒的是，现在这个价格真的太香了，想入手的话就是现在。`,
    ],
    cta: [
      (p) => `喜欢就赶紧入手。`,
      () => `喜欢就赶紧入手，真的会卖断货。`,
      () => `如果你也想要，现在就下单——这一批真的撑不了太久，我先把链接放这了。`,
    ],
  },
};

const VARIANTS: Record<AdLanguage, Record<Tone, Record<BeatRole, Make[]>>> = { en: EN, zh: ZH };

// ---------------------------------------------------------------------------
// Language resolution + assembly
// ---------------------------------------------------------------------------

export function resolveLanguage(input: RewriteInput): AdLanguage {
  if (input.language && input.language !== "auto") return input.language;
  const productText = `${input.product.name} ${input.product.description ?? ""}`.trim();
  if (productText.length > 0) {
    const han = (productText.match(/\p{Script=Han}/gu) ?? []).length;
    const letters = (productText.match(/\p{L}/gu) ?? []).length;
    if (letters > 0) return han / letters > 0.3 ? "zh" : "en";
  }
  const transcript = input.dna.beats
    .map((b) => b.transcript ?? "")
    .join(" ")
    .trim();
  if (transcript.length > 0) {
    const han = (transcript.match(/\p{Script=Han}/gu) ?? []).length;
    const letters = (transcript.match(/\p{L}/gu) ?? []).length;
    if (letters > 0) return han / letters > 0.3 ? "zh" : "en";
  }
  return "en";
}

function windowMidpoint(beat: AdDNABeat): number {
  const [min, max] = beat.targetWords ?? [8, 8];
  return Math.round((min + max) / 2);
}

function assemble(beat: AdDNABeat, text: string, language: AdLanguage): BeatScript {
  const units = countTextUnits(text, language);
  const [min, max] = beat.targetWords ?? [units, units];
  return {
    index: beat.index,
    role: beat.role,
    text,
    units,
    inWindow: units >= min && units <= max,
  };
}

function finish(beats: BeatScript[], composer: "llm" | "rule", language: AdLanguage): RewriteResult {
  const inWindow = beats.filter((b) => b.inWindow).length;
  return {
    script: beats.map((b) => b.text).join(language === "zh" ? "" : " "),
    beats,
    composer,
    language,
    energyMatch: beats.length > 0 ? round3(inWindow / beats.length) : 0,
  };
}

function round3(nv: number): number {
  return Math.round(nv * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Rule path
// ---------------------------------------------------------------------------

export function ruleRewrite(input: RewriteInput, language: AdLanguage): RewriteResult {
  const tone = normalizeTone(input.tone);
  const table = VARIANTS[language][tone];
  const beats = input.dna.beats.map((beat) => {
    const candidates = table[beat.role] ?? table.value;
    const target = windowMidpoint(beat);
    let best: string | null = null;
    let bestDelta = Infinity;
    for (const make of candidates) {
      const text = make(input.product);
      const delta = Math.abs(countTextUnits(text, language) - target);
      if (delta < bestDelta) {
        best = text;
        bestDelta = delta;
      }
    }
    return assemble(beat, best!, language);
  });
  return finish(beats, "rule", language);
}

// ---------------------------------------------------------------------------
// LLM path — hard constraints in, JSON beats out, strict accept/reject
// ---------------------------------------------------------------------------

/** Pure validator: exact beat count, every text inside its window, or null. */
export function validateBeatTexts(
  raw: unknown,
  dna: AdDNA,
  language: AdLanguage,
): BeatScript[] | null {
  if (typeof raw !== "object" || raw === null) return null;
  const arr = (raw as { beats?: unknown }).beats;
  if (!Array.isArray(arr) || arr.length !== dna.beats.length) return null;
  const beats: BeatScript[] = [];
  for (let i = 0; i < arr.length; i++) {
    const entry: unknown = arr[i];
    if (typeof entry !== "object" || entry === null) return null;
    const text = (entry as { text?: unknown }).text;
    if (typeof text !== "string" || text.trim().length === 0) return null;
    const script = assemble(dna.beats[i]!, text.trim(), language);
    if (!script.inWindow) return null;
    beats.push(script);
  }
  return beats;
}

function extractJson(content: string): string {
  const cleaned = content.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  return start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
}

async function tryLlmRewrite(
  input: RewriteInput,
  language: AdLanguage,
  attempt: number,
): Promise<RewriteResult | null> {
  const baseUrl = process.env.STUDIO_LLM_BASE_URL!.replace(/\/$/, "");
  const apiKey = process.env.STUDIO_LLM_API_KEY!;
  const model = process.env.STUDIO_LLM_MODEL ?? "gpt-4o-mini";

  const system =
    "You are a short-form ad scriptwriter. Return ONLY a JSON object: " +
    '{"beats":[{"index":0,"text":"..."}]}. The beats array must contain exactly the requested ' +
    "number of beats, in order. Write in the requested language. Each text's unit count " +
    "(words for English, Chinese characters for Chinese) MUST be inside its window. " +
    "No markdown, no commentary.";
  const user = [
    `Language: ${language === "zh" ? "Chinese (中文)" : "English"}`,
    input.tone ? `Tone: ${input.tone}` : "Tone: energetic",
    `Product: ${JSON.stringify({ name: input.product.name, description: input.product.description, price: input.product.price })}`,
    "Beats (write one text per beat, respecting role, seconds and the targetWords window):",
    JSON.stringify(
      input.dna.beats.map((b) => ({
        index: b.index,
        role: b.role,
        seconds: round3(b.endSec - b.startSec),
        targetWords: b.targetWords,
      })),
    ),
    attempt > 0
      ? `REMINDER: exactly ${input.dna.beats.length} beats, and EVERY text length must be within its [min,max] window.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = body.choices?.[0]?.message?.content?.trim();
  if (!content) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(content));
  } catch {
    return null;
  }
  const beats = validateBeatTexts(parsed, input.dna, language);
  return beats ? finish(beats, "llm", language) : null;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function rewriteScript(input: RewriteInput): Promise<RewriteResult> {
  const language = resolveLanguage(input);
  if (process.env.STUDIO_LLM_BASE_URL?.trim() && process.env.STUDIO_LLM_API_KEY?.trim()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await tryLlmRewrite(input, language, attempt).catch(() => null);
      if (result) return result;
    }
  }
  return ruleRewrite(input, language);
}
