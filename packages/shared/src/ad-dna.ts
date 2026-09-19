/**
 * AdDNA — the replication protocol shared by the ad-reference and
 * product-link pipelines. A reference ad is decomposed into (or a platform
 * preset synthesizes) one AdDNA; the renderer consumes AdDNA and nothing
 * else, so "same hook, same energy" becomes a measurable contract.
 *
 * Replication targets (verified by a recreate-report, not pixel copies):
 *   beat count exact · per-beat duration ≤0.3s · per-beat word count ±20%
 *   hook/CTA position · canvas + total duration.
 */

export type BeatRole = "hook" | "context" | "value" | "proof" | "offer" | "cta";

export type BeatTransition = "cut" | "fade" | "whip";

/** Where the transcript came from — drives confidence reporting. */
export type AdDNATranscriptSource = "pasted" | "asr" | "none";

/** Which physical signals backed the beat boundaries. */
export type AdDNABeatSource = "audio+scene" | "audio" | "scene" | "preset";

export interface AdDNAVisualCue {
  /** Render template pack id (consumed from R3 onward). */
  template: string;
  emphasis: "product" | "type" | "mixed";
  transition: BeatTransition;
}

export interface AdDNABeat {
  index: number;
  role: BeatRole;
  /** Semantic time anchor: scene switches, caption cues and transitions all project from beat edges. */
  startSec: number;
  endSec: number;
  /** Word-count window the script rewriter must land in (the energy constraint). */
  targetWords?: [number, number];
  /** Reference transcript for this beat — rhythm statistics only, never rendered. */
  transcript?: string;
  visual: AdDNAVisualCue;
}

export interface AdDNAStyleTokens {
  /** Dominant colors (hex), most frequent first. */
  paletteDominant: string[];
  captionStyle: "karaoke" | "bubble" | "lower-third";
  cutsPerSec: number;
}

export interface AdDNAEnergyProfile {
  /** Speech rate per beat (words or CJK chars per second). */
  wordsPerSec: number[];
  /** Shot-change rate per beat. */
  cutsPerSec: number[];
}

export interface AdDNAProvenance {
  transcriptSource: AdDNATranscriptSource;
  beatSource: AdDNABeatSource;
  roleSource: "rule" | "llm";
  /** Share of interior beat boundaries backed by a measured signal (0–1); 0 for preset fallback. */
  confidence: number;
}

export interface AdDNA {
  version: 1;
  durationSec: number;
  canvas: { aspectRatio: string; resolution: number };
  beats: AdDNABeat[];
  style: AdDNAStyleTokens;
  energy: AdDNAEnergyProfile;
  provenance: AdDNAProvenance;
}

/** Word-level ASR evidence: measurements, not yet a timeline. */
export interface AsrWord {
  text: string;
  startSec: number;
  endSec: number;
}

export interface AsrSegment {
  text: string;
  startSec: number;
  endSec: number;
  words?: AsrWord[];
}

// ---------------------------------------------------------------------------
// Replica verification (recreate-report)
// ---------------------------------------------------------------------------

export interface RecreateGate {
  key: string;
  label: string;
  pass: boolean;
  detail: string;
}

/**
 * Reference vs final-script comparison — the measurable "100% replication"
 * contract (docs/DESIGN-AD-DNA.md §0). Gates 1-6 are hard; style tokens are
 * informational.
 */
export interface RecreateReport {
  mode: "strict" | "loose";
  gates: RecreateGate[];
  /** Share of hard gates passed (0-1). */
  score: number;
  /** Pearson r between reference and final per-beat speech rates; null under 2 beats. */
  wordsPerSecCorrelation: number | null;
}
