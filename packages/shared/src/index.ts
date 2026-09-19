/** API contract shared by apps/api and apps/web. */

export type Kind = "image" | "video";

export type AspectRatio = "1:1" | "3:4" | "4:3" | "9:16" | "16:9";

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type ReferenceRole = "product" | "avatar" | "reference";

export interface ModelInfo {
  id: string;
  name: string;
  kind: Kind;
  provider: string;
  creditsPerUnit: number;
  aspectRatios: AspectRatio[];
  resolutions?: string[];
  /** Enumerated durations (cloud channels). Mutually exclusive with durationRange. */
  durations?: number[];
  /** Continuous duration span (local engines can render any length). */
  durationRange?: { min: number; max: number };
  maxCount: number;
}

export interface ReferenceInput {
  assetId: string;
  role: ReferenceRole;
}

export interface GenerationParams {
  aspectRatio: AspectRatio;
  resolution?: string;
  durationSec?: number;
  count: number;
  references?: ReferenceInput[];
  /** Agentic provenance (ad-reference / product-link pipelines). */
  agent?: Record<string, unknown>;
}

export interface CreateGenerationRequest {
  kind: Kind;
  model: string;
  prompt: string;
  params: GenerationParams;
  /** Template recreate bookkeeping (optional). */
  templateId?: string;
  /** QC-failed regeneration reuses the original cost (no double billing). */
  freeResampleOf?: string;
}

export interface AssetDto {
  id: string;
  kind: Kind | "upload";
  mime: string;
  bytes: number;
  url: string;
  createdAt: string;
}

export interface GenerationDto {
  id: string;
  jobId: string;
  url: string;
  kind: Kind;
  model: string;
  index: number;
  favorite: boolean;
  meta: Record<string, string>;
  /** Automatic QC verdict ("passed" | "flagged"); null when not applicable. */
  qcStatus?: "passed" | "flagged" | null;
  /** Human review verdict from the acceptance flow. */
  reviewStatus?: "approved" | "rejected" | null;
  createdAt: string;
}

export interface JobDto {
  id: string;
  kind: Kind;
  model: string;
  prompt: string;
  params: GenerationParams;
  status: JobStatus;
  progress: number;
  costCredits: number;
  error?: string;
  templateId?: string;
  generations: GenerationDto[];
  createdAt: string;
  updatedAt: string;
}

export type TemplateCategory =
  | "product-shot"
  | "motion"
  | "ugc"
  | "ads"
  | "posters"
  | "marketplace";

export interface TemplateDto {
  id: string;
  slug: string;
  title: string;
  category: TemplateCategory;
  kind: Kind;
  credits: number;
  thumbUrl: string;
  aspectRatio: AspectRatio;
  promptTemplate: string;
}

export interface CreditLedgerEntry {
  id: string;
  delta: number;
  reason: string;
  jobId?: string;
  createdAt: string;
}

export interface CreditState {
  balance: number;
  ledger: CreditLedgerEntry[];
}

export interface ProjectDto {
  id: string;
  name: string;
  createdAt: string;
}

/** SSE event payloads for GET /v1/generations/:id/events */
export type JobEvent =
  | { type: "status"; jobId: string; status: JobStatus; progress: number }
  | { type: "generation"; jobId: string; generation: GenerationDto }
  | { type: "done"; jobId: string; status: JobStatus; error?: string };
