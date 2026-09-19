import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { initDb } from "../src/db/index.js";
import { initRegistry } from "../src/providers/registry.js";
import { buildServer } from "../src/server.js";
import { storeArtifact } from "../src/storage.js";
import { runAdReferencePipeline } from "../src/agents/pipeline.js";
import { makeVoicedFixture } from "./fixtures.js";

/**
 * S3 acceptance: the edit-and-rerender loop over the real HTTP layer —
 * GET script exposes the AdDNA + per-beat texts, POST rerender validates the
 * edit, creates a billed "edit" job carrying the replica contract, and the
 * report re-verifies the adjusted script.
 */

let dir: string;
let app: FastifyInstance;
let apiKey = "";
let tenantId = "";
let jobId = "";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "studio-edit-"));
  await initDb(dir);
  initRegistry({ port: 0, webOrigin: "http://127.0.0.1:5273", dataDir: dir });
  app = await buildServer({ port: 0, webOrigin: "http://127.0.0.1:5273", dataDir: dir });
  await app.ready();

  const reg = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { email: "edit@test.dev", password: "password123", orgName: "Edit Test" },
  });
  apiKey = reg.json().apiKey;
  // the signup grant belongs to the tenant, not the user — resolve via the hashed key
  const me = (await app.inject({
    method: "GET",
    url: "/v1/auth/me",
    headers: { "x-api-key": apiKey },
  })).json();
  tenantId = me.tenant.id;

  // seed a beat-anchored ad-reference job through the real pipeline
  const voiced = await makeVoicedFixture(dir);
  const asset = await storeArtifact(tenantId, readFileSync(voiced), "video/mp4", "upload");
  const job = await runAdReferencePipeline(tenantId, {
    referenceAssetId: asset.id,
    transcript: "Stop scrolling. This bottle changes everything. Grab yours today.",
  });
  jobId = job.id;
}, 60000);

afterAll(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("edit-and-rerender", () => {
  it("exposes the beat script of an agent job", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/generations/${jobId}/script`,
      headers: { "x-api-key": apiKey },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.beatTexts).toHaveLength(3);
    expect(body.dna.beats.map((b: { role: string }) => b.role)).toEqual(["hook", "value", "cta"]);
    expect(body.language).toBe("en");
  });

  it("rerenders with edited beats and re-verifies the replica contract", async () => {
    const script = await app.inject({
      method: "GET",
      url: `/v1/generations/${jobId}/script`,
      headers: { "x-api-key": apiKey },
    });
    const beatTexts = script.json().beatTexts.map((b: { index: number; text: string }) => ({ ...b }));
    beatTexts[0]!.text = "Wait for it — EditKit.";

    const res = await app.inject({
      method: "POST",
      url: `/v1/generations/${jobId}/rerender`,
      headers: { "x-api-key": apiKey, "content-type": "application/json" },
      payload: JSON.stringify({ beatTexts }),
    });
    expect(res.statusCode).toBe(201);
    const { job, report } = res.json();
    expect(job.params.agent.source).toBe("edit");
    expect(job.params.agent.basedOn).toBe(jobId);
    expect(job.prompt).toContain("EditKit");
    expect(job.params.durationSec).toBe(script.json().dna.durationSec);
    expect(job.status).toBe("queued");
    expect(report.gates).toHaveLength(6);
  });

  it("rejects beat edits that break the structure", async () => {
    const bad = await app.inject({
      method: "POST",
      url: `/v1/generations/${jobId}/rerender`,
      headers: { "x-api-key": apiKey, "content-type": "application/json" },
      payload: JSON.stringify({ beatTexts: [{ text: "only one beat" }] }),
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe("invalid_beats");

    const empty = await app.inject({
      method: "POST",
      url: `/v1/generations/${jobId}/rerender`,
      headers: { "x-api-key": apiKey, "content-type": "application/json" },
      payload: JSON.stringify({ beatTexts: [{ text: "a" }, { text: "  " }, { text: "c" }] }),
    });
    expect(empty.statusCode).toBe(400);
  });

  it("404s for direct jobs without agent metadata", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/generations",
      headers: { "x-api-key": apiKey, "content-type": "application/json" },
      payload: {
        kind: "image",
        model: "studio-image-v1",
        prompt: "plain shot",
        params: { aspectRatio: "1:1", count: 1 },
      },
    });
    const id = created.json().job.id;
    const res = await app.inject({
      method: "GET",
      url: `/v1/generations/${id}/script`,
      headers: { "x-api-key": apiKey },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("no_script");
  });
});
