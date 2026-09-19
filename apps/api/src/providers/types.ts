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
  /** Store produced bytes; returns the public URL assigned by the artifact store. */
  storeArtifact(buffer: Buffer, mime: string): Promise<void>;
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
