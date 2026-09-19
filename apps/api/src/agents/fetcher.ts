import { lookup } from "node:dns/promises";
import { SubmissionError } from "../jobs.js";

/**
 * Product-page fetcher v2: Open Graph + JSON-LD (Product schema) + hero
 * image candidates, with SSRF hardening — every redirect hop's host is
 * resolved and private/loopback addresses are refused unless
 * STUDIO_ALLOW_PRIVATE_FETCH is set (dev/test override). Works against real
 * storefronts and local fixtures.
 */

export interface ProductPage {
  title: string;
  description?: string;
  price?: string;
  brand?: string;
  url: string;
  /** Ordered absolute image candidates (og:image set → JSON-LD → hero <img>), deduped, ≤4. */
  images: string[];
  /** Back-compat: first candidate. */
  imageUrl?: string;
}

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const MAX_IMAGES = 4;

function meta(html: string, keys: string[]): string | undefined {
  for (const key of keys) {
    const patterns = [
      new RegExp(`<meta[^>]+property=["']${key}["'][^>]+content=["']([^"']+)["']`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${key}["']`, "i"),
      new RegExp(`<meta[^>]+name=["']${key}["'][^>]+content=["']([^"']+)["']`, "i"),
    ];
    for (const re of patterns) {
      const match = re.exec(html);
      if (match?.[1]) return decode(match[1].trim());
    }
  }
  return undefined;
}

function metaAll(html: string, key: string): string[] {
  const out: string[] = [];
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${key}["'][^>]+content=["']([^"']+)["']`, "gi"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${key}["']`, "gi"),
  ];
  for (const re of patterns) {
    for (const match of html.matchAll(re)) {
      if (match[1]) out.push(decode(match[1].trim()));
    }
  }
  return out;
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/>/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
}

// --- SSRF guard -------------------------------------------------------------

function isPrivateAddress(ip: string): boolean {
  if (ip.includes(":")) {
    const v6 = ip.toLowerCase();
    return (
      v6 === "::1" || v6 === "::" ||
      v6.startsWith("fc") || v6.startsWith("fd") || // fc00::/7 unique local
      v6.startsWith("fe8") || v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb") // link-local
    );
  }
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
  const [a, b] = parts as [number, number, number?, number?];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

async function assertPublicHost(url: URL): Promise<void> {
  if (process.env.STUDIO_ALLOW_PRIVATE_FETCH === "1") return; // dev/test override, documented in .env.example
  let addrs;
  try {
    addrs = await lookup(url.hostname, { all: true });
  } catch {
    throw new SubmissionError(422, "invalid_url", "That host could not be resolved.");
  }
  for (const addr of addrs) {
    if (isPrivateAddress(addr.address)) {
      throw new SubmissionError(422, "blocked_host", "That host is not reachable from the studio.");
    }
  }
}

/** fetch with a per-hop SSRF re-check across redirects. */
export async function guardedFetch(rawUrl: string): Promise<Response> {
  let url = new URL(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(url);
    const response = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; MakerStudioBot/1.0)" },
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return response;
      response.body?.cancel();
      url = new URL(location, url);
      continue;
    }
    return response;
  }
  throw new SubmissionError(422, "too_many_redirects", "That page redirects too many times.");
}

// --- JSON-LD Product --------------------------------------------------------

interface JsonLdNode {
  "@type"?: string | string[];
  name?: string;
  description?: string;
  brand?: { name?: string } | string;
  offers?: { price?: string | number; priceCurrency?: string } | Array<{ price?: string | number }>;
  image?: string | string[];
}

function asArray(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function collectJsonLdProducts(html: string): JsonLdNode[] {
  const nodes: JsonLdNode[] = [];
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(decode(block[1]!.trim())) as unknown;
      const queue: unknown[] = [parsed];
      while (queue.length > 0) {
        const node = queue.shift();
        if (Array.isArray(node)) {
          queue.push(...node);
          continue;
        }
        if (typeof node === "object" && node !== null) {
          const obj = node as { "@graph"?: unknown; "@type"?: unknown };
          if (obj["@graph"]) queue.push(obj["@graph"]);
          const type = obj["@type"];
          const types = Array.isArray(type) ? type.map(String) : type ? [String(type)] : [];
          if (types.some((t) => t.toLowerCase() === "product")) nodes.push(node as JsonLdNode);
        }
      }
    } catch {
      // malformed JSON-LD is normal on real pages
    }
  }
  return nodes;
}

// --- main -------------------------------------------------------------------

export async function fetchProductPage(rawUrl: string): Promise<ProductPage> {
  const url = new URL(rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`);
  const response = await guardedFetch(url.toString());
  if (!response.ok) throw new SubmissionError(422, "scrape_failed", `The page returned HTTP ${response.status}.`);
  // cap the parse window — page weight beyond 2MB is boilerplate
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || received > MAX_BYTES) break;
    chunks.push(value!);
    received += value!.byteLength;
  }
  const html = Buffer.concat(chunks).toString("utf8");

  const title =
    meta(html, ["og:title", "twitter:title"]) ??
    decode(/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? url.hostname);
  const description = meta(html, ["og:description", "description", "twitter:description"]);
  const priceMeta = meta(html, ["product:price:amount", "og:price:amount"]);

  const products = collectJsonLdProducts(html);
  const product = products[0];
  const jsonLdPrice = product?.offers
    ? (Array.isArray(product.offers) ? product.offers[0]?.price : product.offers.price)
    : undefined;
  const price = priceMeta ?? (jsonLdPrice != null ? String(jsonLdPrice) : /"price"\s*:\s*"?([\d.]+)/.exec(html)?.[1]);
  const brand = typeof product?.brand === "string" ? product.brand : product?.brand?.name;

  // image candidates: og:image set → JSON-LD images → hero <img> heuristics
  const candidates: string[] = [];
  const push = (raw?: string) => {
    if (!raw) return;
    try {
      const abs = new URL(decode(raw), url).toString();
      if (!candidates.includes(abs)) candidates.push(abs);
    } catch {
      // skip malformed urls
    }
  };
  metaAll(html, "og:image").forEach(push);
  meta(html, ["twitter:image", "og:image:url"]) && push(meta(html, ["twitter:image", "og:image:url"]));
  asArray(product?.image).forEach(push);
  if (candidates.length < MAX_IMAGES) {
    const titleWords = (title.toLowerCase().match(/[a-z]{4,}/g) ?? []).slice(0, 3);
    for (const match of html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi)) {
      const tag = match[0];
      const src = match[1]!;
      const alt = /alt=["']([^"']*)["']/i.exec(tag)?.[1] ?? "";
      const hints = /product|main|hero|primary/i.test(src) || titleWords.some((w) => alt.toLowerCase().includes(w));
      if (hints) push(src);
      if (candidates.length >= MAX_IMAGES) break;
    }
  }
  const images = candidates.slice(0, MAX_IMAGES);

  return { title, description, price, brand, url: url.toString(), images, imageUrl: images[0] };
}
