/**
 * Product-page fetcher: Open Graph + JSON-LD extraction with a hard size
 * cap and timeout. Works against real storefronts and local fixtures.
 */

export interface ProductPage {
  title: string;
  description?: string;
  imageUrl?: string;
  price?: string;
  url: string;
}

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

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/>/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
}

export async function fetchProductPage(rawUrl: string): Promise<ProductPage> {
  const url = new URL(rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`);
  const response = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; MakerStudioBot/1.0)" },
    redirect: "follow",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`fetch failed ${response.status}`);
  // cap the parse window — page weight beyond 2MB is boilerplate
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || received > 2 * 1024 * 1024) break;
    chunks.push(value!);
    received += value!.byteLength;
  }
  const html = Buffer.concat(chunks).toString("utf8");

  const title =
    meta(html, ["og:title", "twitter:title"]) ??
    decode(/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? url.hostname);
  const description = meta(html, ["og:description", "description", "twitter:description"]);
  let imageUrl = meta(html, ["og:image", "twitter:image", "og:image:url"]);
  if (imageUrl && !imageUrl.startsWith("http")) {
    imageUrl = new URL(imageUrl, url).toString();
  }
  const jsonLd = /"price"\s*:\s*"?([\d.]+)/.exec(html)?.[1];
  const priceMeta = meta(html, ["product:price:amount", "og:price:amount"]);
  const price = priceMeta ?? jsonLd;

  return { title, description, imageUrl, price, url: url.toString() };
}
