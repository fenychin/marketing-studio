import type { GenerationParams, ReferenceRole } from "@studio/shared";

export interface ReferencePayload {
  role: ReferenceRole;
  buffer: Buffer;
  mime: string;
}

export interface GenerateContext {
  prompt: string;
  params: GenerationParams;
  references: ReferencePayload[];
  seedBase: number;
  reportProgress(percent: number, note?: string): void;
  /** Cooperative cancellation: throws when the job is no longer running. */
  throwIfCancelled(): Promise<void>;
  /** Store produced bytes; optional meta is persisted on the generation row. */
  storeArtifact(buffer: Buffer, mime: string, meta?: Record<string, string>): Promise<void>;
}

export interface ProducedArtifact {
  mime: string;
  meta: Record<string, string>;
}

/**
 * Provider = one channel implementation (mock, an HTTP protocol, …).
 * The queue owns persistence/credits; a provider only turns a request into
 * artifacts pushed through ctx.storeArtifact.
 */
export interface ModelProvider {
  readonly id: string;
  run(ctx: GenerateContext): Promise<ProducedArtifact[]>;
}
