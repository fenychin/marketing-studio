import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AdDNA, BeatRole } from "@studio/shared";
import { buildAdDNA, countTextUnits } from "../src/agents/dna.js";
import {
  resolveLanguage,
  rewriteScript,
  ruleRewrite,
  validateBeatTexts,
} from "../src/agents/rewrite.js";
import { makeVoicedFixture } from "./fixtures.js";

/**
 * R2 acceptance: the per-beat rewriter lands every beat inside its word
 * window (rule path, EN + ZH), the LLM path is constrained by a pure
 * accept/reject validator (mock server, fenced JSON, retry-then-fallback),
 * and the full chain dna → script runs without any network.
 */

let workDir: string;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "studio-rewrite-test-"));
  delete process.env.STUDIO_LLM_BASE_URL;
  delete process.env.STUDIO_LLM_API_KEY;
  delete process.env.STUDIO_ASR_URL;
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
  delete process.env.STUDIO_LLM_BASE_URL;
  delete process.env.STUDIO_LLM_API_KEY;
});

const PRODUCT = { name: "TestKit", description: "Keeps your desk organized.", price: "$19" };

function dnaWith(beats: Array<{ role: BeatRole; targetWords: [number, number] }>): AdDNA {
  let t = 0;
  return {
    version: 1,
    durationSec: beats.length * 2.5,
    canvas: { aspectRatio: "9:16", resolution: 720 },
    beats: beats.map((b, i) => {
      const start = t;
      t += 2.5;
      return {
        index: i,
        role: b.role,
        startSec: start,
        endSec: t,
        targetWords: b.targetWords,
        visual: { template: "karaoke-uw", emphasis: "type", transition: "cut" },
      };
    }),
    style: { paletteDominant: ["#808080"], captionStyle: "karaoke", cutsPerSec: 0 },
    energy: { wordsPerSec: [], cutsPerSec: [] },
    provenance: { transcriptSource: "none", beatSource: "preset", roleSource: "rule", confidence: 0 },
  };
}

describe("ruleRewrite", () => {
  it("lands every beat inside its window and preserves the beat grammar (en)", () => {
    const dna = dnaWith([
      { role: "hook", targetWords: [3, 12] },
      { role: "context", targetWords: [4, 12] },
      { role: "value", targetWords: [4, 12] },
      { role: "proof", targetWords: [4, 12] },
      { role: "offer", targetWords: [4, 14] },
      { role: "cta", targetWords: [3, 12] },
    ]);
    const result = ruleRewrite({ dna, product: PRODUCT }, "en");
    expect(result.composer).toBe("rule");
    expect(result.language).toBe("en");
    expect(result.energyMatch).toBe(1);
    expect(result.beats.map((b) => b.role)).toEqual(["hook", "context", "value", "proof", "offer", "cta"]);
    for (const beat of result.beats) {
      expect(beat.inWindow).toBe(true);
      expect(beat.text.length).toBeGreaterThan(0);
    }
    expect(result.script).toContain("TestKit");
  });

  it("picks the shortest variant for a tight window", () => {
    const dna = dnaWith([{ role: "hook", targetWords: [2, 3] }]);
    const result = ruleRewrite({ dna, product: PRODUCT }, "en");
    expect(result.beats[0]!.units).toBeLessThanOrEqual(3);
    expect(result.energyMatch).toBe(1);
  });

  it("reports honest energyMatch when no variant can fit an impossible window", () => {
    const dna = dnaWith([{ role: "cta", targetWords: [30, 40] }]);
    const result = ruleRewrite({ dna, product: PRODUCT }, "en");
    expect(result.beats[0]!.inWindow).toBe(false);
    expect(result.energyMatch).toBe(0);
  });

  it("writes Chinese scripts with Han-character unit counting", () => {
    const dna = dnaWith([
      { role: "hook", targetWords: [2, 20] },
      { role: "value", targetWords: [2, 25] },
      { role: "cta", targetWords: [2, 25] },
    ]);
    const result = ruleRewrite(
      { dna, product: { name: "便携榨汁杯", description: "三十秒快速出汁。" } },
      "zh",
    );
    expect(result.language).toBe("zh");
    expect(result.energyMatch).toBe(1);
    expect(result.script).toContain("便携榨汁杯");
    // no latin word joins — Chinese beats concatenate without spaces
    expect(result.script.startsWith("别划走") || result.script.includes("，")).toBe(true);
    for (const beat of result.beats) {
      expect(beat.units).toBe(countTextUnits(beat.text, "zh"));
    }
  });

  it("resolves language from the product, then the reference transcript", () => {
    expect(resolveLanguage({ dna: dnaWith([{ role: "hook", targetWords: [2, 3] }]), product: { name: "便携榨汁杯" } })).toBe("zh");
    expect(resolveLanguage({ dna: dnaWith([{ role: "hook", targetWords: [2, 3] }]), product: { name: "Juice Cup" } })).toBe("en");
    const transcriptDna = dnaWith([{ role: "hook", targetWords: [2, 3] }]);
    transcriptDna.beats[0]!.transcript = "立刻购买，限时五折";
    expect(resolveLanguage({ dna: transcriptDna, product: { name: "12345" } })).toBe("zh");
  });
});

describe("validateBeatTexts", () => {
  const dna = dnaWith([
    { role: "hook", targetWords: [2, 4] },
    { role: "cta", targetWords: [2, 4] },
  ]);

  it("accepts a beat array matching count and windows", () => {
    const beats = validateBeatTexts(
      { beats: [{ index: 0, text: "Buy it now" }, { text: "Get it today" }] },
      dna,
      "en",
    );
    expect(beats).not.toBeNull();
    expect(beats!).toHaveLength(2);
    expect(beats![0]!.role).toBe("hook");
    expect(beats![1]!.role).toBe("cta");
  });

  it("rejects wrong beat count, out-of-window text and malformed entries", () => {
    expect(validateBeatTexts({ beats: [{ text: "Buy it now" }] }, dna, "en")).toBeNull();
    expect(
      validateBeatTexts({ beats: [{ text: "one two three four five six seven" }, { text: "ok" }] }, dna, "en"),
    ).toBeNull();
    expect(validateBeatTexts({ beats: [{ text: "fine here" }, {}] }, dna, "en")).toBeNull();
    expect(validateBeatTexts("not an object", dna, "en")).toBeNull();
  });
});

describe("rewriteScript — LLM path (mock server)", () => {
  const dna = dnaWith([
    { role: "hook", targetWords: [4, 12] },
    { role: "cta", targetWords: [3, 12] },
  ]);

  function startLlm(content: () => string): Promise<{ server: Server; port: number; calls: () => number }> {
    let count = 0;
    const server: Server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        count += 1;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ choices: [{ message: { content: content() } }] }));
      });
    });
    return new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const port = (server.address() as AddressInfo).port;
        resolve({ server, port, calls: () => count });
      });
    });
  }

  it("accepts a valid fenced-JSON answer as the llm composer", async () => {
    const { server, port } = await startLlm(
      () =>
        "```json\n{\"beats\":[{\"index\":0,\"text\":\"Stop scrolling right now, because TestKit just changed everything.\"},{\"index\":1,\"text\":\"Get TestKit today — link in bio.\"}]}\n```",
    );
    process.env.STUDIO_LLM_BASE_URL = `http://127.0.0.1:${port}`;
    process.env.STUDIO_LLM_API_KEY = "test";
    try {
      const result = await rewriteScript({ dna, product: PRODUCT });
      expect(result.composer).toBe("llm");
      expect(result.energyMatch).toBe(1);
      expect(result.beats[0]!.units).toBe(9);
    } finally {
      server.close();
      delete process.env.STUDIO_LLM_BASE_URL;
      delete process.env.STUDIO_LLM_API_KEY;
    }
  });

  it("retries once on an invalid answer, then falls back to the rule path", async () => {
    const { server, port, calls } = await startLlm(() => JSON.stringify({ beats: [{ text: "only one beat" }] }));
    process.env.STUDIO_LLM_BASE_URL = `http://127.0.0.1:${port}`;
    process.env.STUDIO_LLM_API_KEY = "test";
    try {
      const result = await rewriteScript({ dna, product: PRODUCT });
      expect(calls()).toBe(2); // exactly one retry, no more
      expect(result.composer).toBe("rule");
      expect(result.energyMatch).toBe(1); // rule path restores the window contract
    } finally {
      server.close();
      delete process.env.STUDIO_LLM_BASE_URL;
      delete process.env.STUDIO_LLM_API_KEY;
    }
  });
});

describe("full chain without network — buildAdDNA → rewriteScript", () => {
  it("produces an in-window script from the synthetic reference ad", async () => {
    const voiced = await makeVoicedFixture(workDir);
    const dna = await buildAdDNA(readFileSync(voiced), {
      transcript: "Stop scrolling. This bottle changes everything. Grab yours today.",
    });
    expect(dna.provenance.transcriptSource).toBe("pasted");

    const result = await rewriteScript({ dna, product: { name: "GlowBottle" } });
    expect(result.composer).toBe("rule");
    expect(result.language).toBe("en");
    expect(result.beats).toHaveLength(3);
    expect(result.energyMatch).toBe(1);
    expect(result.beats.map((b) => b.role)).toEqual(["hook", "value", "cta"]);
    expect(result.script.split(/\s+/).filter(Boolean).length).toBeGreaterThan(5);
  }, 30000);
});
