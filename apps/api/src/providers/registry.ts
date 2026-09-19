import type { Kind, ModelInfo } from "@studio/shared";
import type { ModelProvider } from "./types.js";
import { MockProvider } from "./mock.js";
import { OpenAiImagesProvider } from "./openai-images.js";
import { LocalRenderProvider } from "./local-render.js";
import { AsyncVideoProvider } from "./async-video.js";
import type { Config } from "../config.js";

interface ModelDef extends Omit<ModelInfo, "provider"> {
  provider: ModelProvider;
}

const IMAGE_RATIOS: ModelInfo["aspectRatios"] = ["1:1", "3:4", "4:3", "9:16", "16:9"];
const VIDEO_RATIOS: ModelInfo["aspectRatios"] = ["9:16", "1:1", "16:9"];

let models: ModelDef[] = [];

export function initRegistry(config: Config): void {
  models = [
    {
      id: "studio-image-v1",
      name: "Studio Image",
      kind: "image",
      provider: new MockProvider("image"),
      creditsPerUnit: 4,
      aspectRatios: IMAGE_RATIOS,
      maxCount: 4,
    },
    {
      id: "studio-motion-v1",
      name: "Studio Motion",
      kind: "video",
      provider: new MockProvider("video"),
      creditsPerUnit: 30,
      aspectRatios: VIDEO_RATIOS,
      resolutions: ["540p", "720p", "1080p"],
      durations: [5, 10, 15],
      maxCount: 2,
    },
    {
      id: "studio-render-v1",
      name: "Studio Render · word-anchored",
      kind: "video",
      provider: new LocalRenderProvider(),
      creditsPerUnit: 60,
      aspectRatios: VIDEO_RATIOS,
      resolutions: ["540p", "720p", "1080p"],
      durationRange: { min: 3, max: 30 },
      maxCount: 2,
    },
  ];

  if (config.videoChannel) {
    models.push({
      id: config.videoChannel.model,
      name: `${config.videoChannel.model} (channel)`,
      kind: "video",
      provider: new AsyncVideoProvider("async-video", config.videoChannel.baseUrl, config.videoChannel.apiKey, config.videoChannel.model),
      creditsPerUnit: 135,
      aspectRatios: VIDEO_RATIOS,
      resolutions: ["540p", "720p", "1080p"],
      durations: [5, 10, 15],
      maxCount: 2,
    });
  }

  if (config.openai) {
    models.push({
      id: config.openai.imageModel,
      name: `${config.openai.imageModel} (channel)`,
      kind: "image",
      provider: new OpenAiImagesProvider("openai-images", config.openai.baseUrl, config.openai.apiKey, config.openai.imageModel),
      creditsPerUnit: 40,
      aspectRatios: IMAGE_RATIOS,
      maxCount: 4,
    });
  }
}

export function listModels(kind?: Kind): ModelInfo[] {
  return models
    .filter((m) => kind === undefined || m.kind === kind)
    .map(({ provider, ...info }) => ({ ...info, provider: provider.id }));
}

export function resolveModel(id: string, kind: Kind): ModelDef | undefined {
  return models.find((m) => m.id === id && m.kind === kind);
}

export function defaultModel(kind: Kind): ModelDef {
  const found = models.find((m) => m.kind === kind);
  if (!found) throw new Error(`no model registered for kind ${kind}`);
  return found;
}
