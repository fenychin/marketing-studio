import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeSilentFixture, makeVoicedFixture } from "./fixtures.js";
import {
  assignRoles,
  buildAdDNA,
  dominantColors,
  evidenceWords,
  fuseBeats,
  isCjkText,
  speechRateFor,
  windowFor,
} from "../src/agents/dna.js";

/**
 * R1 acceptance: the AdDNA parser recovers a known beat structure from a
 * synthetic reference ad (3 color scenes × 3 sine "speech" bursts), reports
 * honest provenance when signals are missing, and degrades through the three
 * transcript tiers (pasted > ASR > rate assumption).
 */

let workDir: string;
let voicedFixture: string; // 8s: red/white/blue scenes + 3 sine bursts
let silentFixture: string; // 6s: single gray still, no audio track

beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), "studio-dna-test-"));
  voicedFixture = await makeVoicedFixture(workDir);
  silentFixture = await makeSilentFixture(workDir);
}, 60000);

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
  delete process.env.STUDIO_ASR_URL;
});

function readFixture(path: string): Buffer {
  return readFileSync(path);
}

describe("fuseBeats", () => {
  it("clusters a speech onset with a nearby shot change into one boundary", () => {
    const fused = fuseBeats({
      durationSec: 10,
      speechSegments: [
        { startSec: 0, endSec: 2.4 },
        { startSec: 2.8, endSec: 7 },
        { startSec: 7.4, endSec: 10 },
      ],
      sceneCuts: [2.6],
      hasAudio: true,
    });
    expect(fused.segments).toHaveLength(3);
    expect(fused.segments[0]!.endSec).toBe(2.6); // earliest signal wins
    expect(fused.measuredBoundaries).toBe(2);
    expect(fused.source).toBe("audio+scene");
  });

  it("prunes boundaries that would create beats shorter than 0.6s", () => {
    const fused = fuseBeats({
      durationSec: 10,
      speechSegments: [],
      sceneCuts: [1.0, 1.55, 9.0],
      hasAudio: false,
    });
    for (const s of fused.segments) {
      expect(s.endSec - s.startSec).toBeGreaterThanOrEqual(0.6);
    }
    expect(fused.segments).toHaveLength(3);
    expect(fused.source).toBe("scene");
  });

  it("falls back to an even preset split when no signals exist", () => {
    const fused = fuseBeats({ durationSec: 6, speechSegments: [], sceneCuts: [], hasAudio: false });
    expect(fused.segments).toHaveLength(2);
    expect(fused.measuredBoundaries).toBe(0);
    expect(fused.source).toBe("preset");
  });
});

describe("pure helpers", () => {
  it("assigns roles with hook first and CTA last", () => {
    expect(assignRoles(1)).toEqual(["hook"]);
    expect(assignRoles(2)).toEqual(["hook", "cta"]);
    expect(assignRoles(3)).toEqual(["hook", "value", "cta"]);
    expect(assignRoles(4)).toEqual(["hook", "context", "value", "cta"]);
    expect(assignRoles(5)).toEqual(["hook", "context", "value", "proof", "cta"]);
  });

  it("detects language and picks the matching speech rate", () => {
    expect(isCjkText("立刻购买，限时五折")).toBe(true);
    expect(isCjkText("Buy now, 50% off today")).toBe(false);
    expect(speechRateFor("立刻购买")).toBeCloseTo(4.2);
    expect(speechRateFor("buy now")).toBeCloseTo(2.6);
  });

  it("builds ±20/25% word windows", () => {
    expect(windowFor(3)).toEqual([2, 4]);
    expect(windowFor(2)).toEqual([2, 3]);
    expect(windowFor(10)[0]).toBeGreaterThanOrEqual(8);
  });

  it("distributes ASR segments without word timings evenly across the span", () => {
    const words = evidenceWords([{ text: "a b c d", startSec: 1, endSec: 3 }]);
    expect(words).toHaveLength(4);
    expect(words[0]!.startSec).toBeCloseTo(1, 5);
    expect(words[3]!.endSec).toBeCloseTo(3, 5);
  });

  it("clusters solid color regions into exact dominant colors", () => {
    const px: number[] = [];
    for (let i = 0; i < 100; i++) px.push(255, 0, 0);
    for (let i = 0; i < 100; i++) px.push(0, 128, 0);
    for (let i = 0; i < 100; i++) px.push(0, 0, 255);
    const palette = dominantColors(new Uint8Array(px), 3);
    expect(palette).toHaveLength(3);
    const channels = palette.map((hex) => [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ]);
    const expected = [
      [255, 0, 0],
      [0, 128, 0],
      [0, 0, 255],
    ];
    for (const [r, g, b] of channels) {
      expect(expected.some(([er, eg, eb]) => Math.abs(er - r) <= 2 && Math.abs(eg - g) <= 2 && Math.abs(eb - b) <= 2)).toBe(true);
    }
  });
});

describe("buildAdDNA — voiced fixture (measured signals)", () => {
  it("recovers 3 beats with full confidence and honest provenance", async () => {
    delete process.env.STUDIO_ASR_URL;
    const dna = await buildAdDNA(readFixture(voicedFixture));

    expect(dna.version).toBe(1);
    expect(dna.durationSec).toBeGreaterThan(7.7);
    expect(dna.durationSec).toBeLessThan(8.3);
    expect(dna.beats).toHaveLength(3);
    expect(dna.beats.map((b) => b.role)).toEqual(["hook", "value", "cta"]);
    expect(dna.beats[0]!.endSec).toBeGreaterThan(2.3);
    expect(dna.beats[0]!.endSec).toBeLessThan(3.1);
    expect(dna.beats[1]!.endSec).toBeGreaterThan(4.9);
    expect(dna.beats[1]!.endSec).toBeLessThan(5.7);

    expect(dna.provenance.beatSource).toBe("audio+scene");
    expect(dna.provenance.confidence).toBe(1);
    expect(dna.provenance.transcriptSource).toBe("none");
    expect(dna.provenance.roleSource).toBe("rule");

    expect(dna.style.cutsPerSec).toBeGreaterThan(0.2);
    expect(dna.style.cutsPerSec).toBeLessThan(0.3);
    expect(dna.style.paletteDominant).toHaveLength(3);
    expect(dna.energy.wordsPerSec).toHaveLength(3);
    expect(dna.energy.cutsPerSec).toHaveLength(3);

    for (const beat of dna.beats) {
      expect(beat.targetWords![0]).toBeGreaterThanOrEqual(2);
      expect(beat.targetWords![1]).toBeGreaterThanOrEqual(beat.targetWords![0]);
      const typeBeat = beat.role === "hook" || beat.role === "cta" || beat.role === "offer";
      expect(beat.visual.template).toBe(typeBeat ? "bigtype-hook" : "karaoke-uw");
    }
  }, 30000);

  it("tier 1 — pasted transcript supplies per-beat word targets", async () => {
    delete process.env.STUDIO_ASR_URL;
    const dna = await buildAdDNA(readFixture(voicedFixture), {
      transcript: "Stop scrolling. This bottle changes everything. Grab yours today.",
    });
    expect(dna.provenance.transcriptSource).toBe("pasted");
    expect(dna.beats[0]!.targetWords).toEqual([2, 3]); // "Stop scrolling."
    expect(dna.beats[1]!.targetWords).toEqual([3, 5]); // "This bottle changes everything."
    expect(dna.beats[2]!.targetWords).toEqual([2, 4]); // "Grab yours today."
    expect(dna.beats[0]!.transcript).toContain("Stop scrolling");
  }, 30000);

  it("tier 2 — ASR evidence measures words and fills transcripts", async () => {
    const server: Server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            segments: [
              {
                text: "buy now ok",
                start: 0,
                end: 2.4,
                words: [
                  { text: "buy", start: 0, end: 0.8 },
                  { text: "now", start: 0.8, end: 1.6 },
                  { text: "ok", start: 1.6, end: 2.4 },
                ],
              },
              { text: "fresh feel great", start: 2.8, end: 5.1 },
            ],
          }),
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    process.env.STUDIO_ASR_URL = `http://127.0.0.1:${port}`;

    try {
      const dna = await buildAdDNA(readFixture(voicedFixture));
      expect(dna.provenance.transcriptSource).toBe("asr");
      expect(dna.beats[0]!.transcript).toBe("buy now ok");
      expect(dna.beats[1]!.transcript).toBe("fresh feel great"); // no word timings → even distribution
      expect(dna.beats[0]!.targetWords).toEqual([2, 4]); // measured 3 words
      expect(dna.energy.wordsPerSec[0]).toBeCloseTo(3 / 2.6, 1);
    } finally {
      server.close();
      delete process.env.STUDIO_ASR_URL;
    }
  }, 30000);
});

describe("buildAdDNA — silent fixture (no signals)", () => {
  it("degrades to preset beats and reports confidence 0", async () => {
    delete process.env.STUDIO_ASR_URL;
    const dna = await buildAdDNA(readFixture(silentFixture));
    expect(dna.durationSec).toBeGreaterThan(5.7);
    expect(dna.durationSec).toBeLessThan(6.3);
    expect(dna.provenance.beatSource).toBe("preset");
    expect(dna.provenance.confidence).toBe(0);
    expect(dna.provenance.transcriptSource).toBe("none");
    expect(dna.beats.map((b) => b.role)).toEqual(["hook", "cta"]);
    expect(dna.style.paletteDominant).toHaveLength(3); // gray frame sampling still yields a palette
  }, 30000);
});
