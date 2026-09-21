import { randomUUID } from "node:crypto";

export interface Config {
  port: number;
  webOrigin: string;
  dataDir: string;
  openai?: { baseUrl: string; apiKey: string; imageModel: string };
  videoChannel?: { baseUrl: string; apiKey: string; model: string };
  minimax?: { baseUrl: string; apiKey: string; model: string };
  seedance?: { baseUrl: string; apiKey: string; model: string };
}

function loadDotEnv(): void {
  try {
    process.loadEnvFile();
  } catch {
    /* no .env file — defaults apply */
  }
}

export function loadConfig(): Config {
  loadDotEnv();
  const baseUrl = process.env.STUDIO_OPENAI_BASE_URL?.trim();
  const apiKey = process.env.STUDIO_OPENAI_API_KEY?.trim();
  const channelUrl = process.env.STUDIO_VIDEO_CHANNEL_URL?.trim();
  const channelKey = process.env.STUDIO_VIDEO_CHANNEL_KEY?.trim();
  return {
    port: Number(process.env.STUDIO_API_PORT ?? "8787"),
    webOrigin: process.env.STUDIO_WEB_ORIGIN ?? "http://127.0.0.1:5273",
    dataDir: process.env.STUDIO_DATA_DIR ?? new URL("../../.data/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    openai: baseUrl && apiKey
      ? { baseUrl: baseUrl.replace(/\/$/, ""), apiKey, imageModel: process.env.STUDIO_OPENAI_IMAGE_MODEL ?? "gpt-image-1" }
      : undefined,
    videoChannel: channelUrl && channelKey
      ? { baseUrl: channelUrl.replace(/\/$/, ""), apiKey: channelKey, model: process.env.STUDIO_VIDEO_CHANNEL_MODEL ?? "channel-video-v1" }
      : undefined,
    minimax: (() => {
      const mmBase = process.env.STUDIO_MINIMAX_BASE_URL?.trim();
      const mmKey = process.env.STUDIO_MINIMAX_API_KEY?.trim();
      return mmBase && mmKey
        ? { baseUrl: mmBase.replace(/\/$/, ""), apiKey: mmKey, model: process.env.STUDIO_MINIMAX_MODEL ?? "MiniMax-H3" }
        : undefined;
    })(),
    seedance: (() => {
      const sdBase = process.env.STUDIO_SEEDANCE_BASE_URL?.trim();
      const sdKey = process.env.STUDIO_SEEDANCE_API_KEY?.trim();
      return sdBase && sdKey
        ? { baseUrl: sdBase.replace(/\/$/, ""), apiKey: sdKey, model: process.env.STUDIO_SEEDANCE_MODEL ?? "doubao-seedance-2-5-pro" }
        : undefined;
    })(),
  };
}

export function uuid(): string {
  return randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}
