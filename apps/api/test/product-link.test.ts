import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AdDNA } from "@studio/shared";
import { fetchProductPage } from "../src/agents/fetcher.js";
import { SubmissionError } from "../src/jobs.js";
import { PLATFORM_PRESETS, buildPlatformDNA, listPlatformIds } from "../src/agents/platforms.js";
import { buildRecreateReport } from "../src/agents/report.js";
import { composeProductLink } from "../src/agents/pipeline.js";

/**
 * R4 acceptance: the product fetcher parses real storefront signals behind
 * an SSRF guard, each platform preset projects a deterministic AdDNA
 * skeleton, and the recreate-report scores the six hard replication gates.
 */

const FIXTURE_HTML = `<!doctype html><html><head>
<title>Acme Bottle — 500ml</title>
<meta property="og:title" content="Acme Bottle 500ml">
<meta property="og:description" content="Keeps drinks cold for 24 hours.">
<meta property="og:price:amount" content="19.90">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Acme Bottle 500ml","description":"Keeps drinks cold for 24 hours.","brand":{"name":"Acme"},"offers":{"price":19.9,"priceCurrency":"USD"},"image":["https://cdn.acme.test/bottle-1.jpg","https://cdn.acme.test/bottle-2.jpg"]}</script>
</head><body>
<img src="/img/hero-bottle.jpg" alt="Acme Bottle product shot">
<img src="/img/random.jpg" alt="decoration">
</body></html>`;

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(FIXTURE_HTML);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // parsing tests fetch the local fixture — the guard override is dev/test only
  process.env.STUDIO_ALLOW_PRIVATE_FETCH = "1";
});

afterAll(() => {
  server.close();
  delete process.env.STUDIO_ALLOW_PRIVATE_FETCH;
});

describe("fetcher v2", () => {
  it("blocks private hosts by default (SSRF guard)", async () => {
    delete process.env.STUDIO_ALLOW_PRIVATE_FETCH;
    await expect(fetchProductPage(baseUrl)).rejects.toMatchObject({ code: "blocked_host" });
    process.env.STUDIO_ALLOW_PRIVATE_FETCH = "1";
  });

  it("parses OG + JSON-LD product signals into ordered image candidates", async () => {
    const page = await fetchProductPage(baseUrl);
    expect(page.title).toBe("Acme Bottle 500ml");
    expect(page.description).toBe("Keeps drinks cold for 24 hours.");
    expect(page.price).toBe("19.90");
    expect(page.brand).toBe("Acme");
    expect(page.images).toEqual([
      "https://cdn.acme.test/bottle-1.jpg",
      "https://cdn.acme.test/bottle-2.jpg",
      `${baseUrl}/img/hero-bottle.jpg`,
    ]); // og:image absent → JSON-LD set first, then the hero <img> hint; random.jpg excluded
    expect(page.imageUrl).toBe(page.images[0]);
  });
});

describe("platform presets", () => {
  it("projects deterministic AdDNA skeletons per platform", () => {
    expect(listPlatformIds()).toEqual(["tiktok", "reels", "shorts"]);
    const product = { name: "Acme Bottle 500ml", description: "Keeps drinks cold for 24 hours." };

    const tiktok = buildPlatformDNA(PLATFORM_PRESETS.tiktok!, product);
    expect(tiktok.durationSec).toBe(28); // mid of [21, 34]
    expect(tiktok.beats.map((b) => b.role)).toEqual(["hook", "context", "value", "offer", "cta"]);
    expect(tiktok.beats[0]!.startSec).toBe(0);
    expect(tiktok.beats[tiktok.beats.length - 1]!.endSec).toBe(28);
    expect(tiktok.provenance.beatSource).toBe("preset");
    expect(tiktok.beats[0]!.visual.template).toBe("bigtype-hook");
    expect(tiktok.beats[2]!.visual.template).toBe("karaoke-uw");

    const reels = buildPlatformDNA(PLATFORM_PRESETS.reels!, product);
    expect(reels.durationSec).toBe(23); // mid of [15, 30]
    expect(reels.beats).toHaveLength(4);

    const shorts = buildPlatformDNA(PLATFORM_PRESETS.shorts!, product);
    expect(shorts.durationSec).toBe(30); // mid of [20, 40], clamped to the engine span
    for (const beat of shorts.beats) {
      expect(beat.targetWords![1]).toBeGreaterThan(beat.targetWords![0]);
    }
    expect(buildPlatformDNA(PLATFORM_PRESETS.tiktok!, product)).toEqual(tiktok); // deterministic
  });
});

describe("recreate-report", () => {
  const dna: AdDNA = {
    version: 1,
    durationSec: 8,
    canvas: { aspectRatio: "9:16", resolution: 720 },
    beats: [
      { index: 0, role: "hook", startSec: 0, endSec: 2.6, targetWords: [3, 8], visual: { template: "bigtype-hook", emphasis: "type", transition: "fade" } },
      { index: 1, role: "value", startSec: 2.6, endSec: 5.2, targetWords: [5, 12], visual: { template: "karaoke-uw", emphasis: "mixed", transition: "cut" } },
      { index: 2, role: "cta", startSec: 5.2, endSec: 8, targetWords: [3, 8], visual: { template: "bigtype-hook", emphasis: "type", transition: "cut" } },
    ],
    style: { paletteDominant: [], captionStyle: "karaoke", cutsPerSec: 0.25 },
    energy: { wordsPerSec: [1.2, 1.5, 1.1], cutsPerSec: [] },
    provenance: { transcriptSource: "pasted", beatSource: "audio+scene", roleSource: "rule", confidence: 1 },
  };
  const goodTexts = ["Stop scrolling now", "It simply works every single day for you", "Get one today"];
  const badTexts = ["Stop scrolling now", "It simply works every single day and then some more and more and more", "Get one today"];

  it("passes all six hard gates for an in-window clone", () => {
    const report = buildRecreateReport({
      dna,
      beatTexts: goodTexts.map((text, index) => ({ index, text })),
      language: "en",
      renderedDurationSec: 8,
      aspectRatio: "9:16",
    });
    expect(report.gates).toHaveLength(6);
    expect(report.score).toBe(1);
    expect(report.wordsPerSecCorrelation).not.toBeNull();
    expect(report.gates.every((g) => g.pass)).toBe(true);
  });

  it("fails the word-window gate when a beat drifts out", () => {
    const report = buildRecreateReport({
      dna,
      beatTexts: badTexts.map((text, index) => ({ index, text })),
      language: "en",
      renderedDurationSec: 8,
      aspectRatio: "9:16",
      mode: "strict",
    });
    const gate = report.gates.find((g) => g.key === "word_window")!;
    expect(gate.pass).toBe(false);
    expect(report.score).toBeLessThan(1);
    expect(report.mode).toBe("strict");
  });

  it("fails the canvas gate on an aspect mismatch", () => {
    const report = buildRecreateReport({
      dna,
      beatTexts: goodTexts.map((text, index) => ({ index, text })),
      language: "en",
      renderedDurationSec: 9.8,
      aspectRatio: "16:9",
    });
    expect(report.gates.find((g) => g.key === "canvas_duration")!.pass).toBe(false);
  });
});

describe("composeProductLink v2", () => {
  it("builds per-platform compositions with reports from one URL", async () => {
    const composed = await composeProductLink("tenant-test", {
      url: baseUrl,
      tone: "energetic",
      platforms: ["tiktok", "reels"],
    });
    expect(composed.product.name).toBe("Acme Bottle 500ml");
    expect(composed.product.price).toBe("19.90");
    expect(composed.platforms.map((p) => p.platform)).toEqual(["tiktok", "reels"]);
    for (const platform of composed.platforms) {
      expect(platform.script.split(/\s+/).filter(Boolean).length).toBeGreaterThan(8);
      expect(platform.beatTexts).toHaveLength(platform.dna.beats.length);
      expect(platform.report.gates).toHaveLength(6);
      expect(platform.report.score).toBeGreaterThan(0.4);
      expect(platform.language).toBe("en");
    }
  });
});
