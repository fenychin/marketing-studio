/**
 * Word-level alignment — the "anchored to words, not seconds" core.
 *
 * Two implementations ship now; the interface is the port where a real ASR
 * aligner (faster-whisper / whisper.cpp sidecar) drops in later without
 * touching the timeline or renderer.
 */

export interface AlignedWord {
  word: string;
  startSec: number;
  endSec: number;
}

export interface AlignedSegment {
  text: string;
  startSec: number;
  endSec: number;
  words: AlignedWord[];
}

export interface Alignment {
  segments: AlignedSegment[];
  durationSec: number;
  source: "synthetic" | "srt" | "asr";
}

const PAUSE_SEC = 0.28; // pause inserted at sentence punctuation
const WORD_WEIGHT = (word: string): number => Math.max(2, word.replace(/[^\p{L}\p{N}]/gu, "").length) + 1;

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?。！？])\s+|(?<=[.!?。！？]$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function distributeWords(sentence: string, startSec: number, endSec: number): AlignedWord[] {
  const words = sentence.split(/\s+/).filter(Boolean);
  const total = words.reduce((sum, w) => sum + WORD_WEIGHT(w), 0) || 1;
  const span = endSec - startSec;
  let cursor = startSec;
  return words.map((word) => {
    const dur = (WORD_WEIGHT(word) / total) * span;
    const start = cursor;
    cursor += dur;
    return { word, startSec: round3(start), endSec: round3(Math.min(cursor, endSec)) };
  });
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Estimate word timings from a script: speech-rate based, sentence pauses
 * preserved, total duration clamped/padded to the requested length.
 */
export function synthesizeAlignment(script: string, durationSec?: number): Alignment {
  const sentences = splitSentences(script);
  const weights = sentences.map((s) => s.split(/\s+/).reduce((sum, w) => sum + WORD_WEIGHT(w), 0));
  const rawTotal = weights.reduce((a, b) => a + b, 0) + PAUSE_SEC * Math.max(0, sentences.length - 1);
  const target = durationSec && durationSec > 1 ? durationSec : Math.min(30, Math.max(3, rawTotal / 2.75));
  const scale = target / rawTotal;

  const segments: AlignedSegment[] = [];
  let cursor = 0;
  sentences.forEach((sentence, i) => {
    const span = weights[i]! * scale;
    const start = cursor;
    const end = cursor + span;
    cursor = end + (i < sentences.length - 1 ? PAUSE_SEC * scale : 0);
    segments.push({
      text: sentence,
      startSec: round3(start),
      endSec: round3(end),
      words: distributeWords(sentence, start, end),
    });
  });

  return { segments, durationSec: round3(target), source: "synthetic" };
}

/** Minimal SRT (blocks with plain-text cues) → per-cue word distribution. */
export function parseSrtAlignment(srt: string): Alignment {
  const blocks = srt.replace(/\r/g, "").split(/\n\n+/).filter(Boolean);
  const segments: AlignedSegment[] = [];
  const stamp = (s: string): number => {
    const [hms, ms] = s.split(",");
    const [h, m, sec] = hms!.split(":").map(Number);
    return (h! * 3600 + m! * 60 + sec!) * 1000 + Number(ms) / 1000;
  };
  for (const block of blocks) {
    const lines = block.split("\n");
    const timeLine = lines.find((l) => l.includes("-->"));
    if (!timeLine) continue;
    const [from, to] = timeLine.split("-->").map((x) => x.trim());
    const text = lines.slice(lines.indexOf(timeLine) + 1).join(" ").trim();
    if (!text) continue;
    segments.push({
      text,
      startSec: round3(stamp(from!)),
      endSec: round3(stamp(to!)),
      words: distributeWords(text, stamp(from!), stamp(to!)),
    });
  }
  const durationSec = segments.length > 0 ? segments[segments.length - 1]!.endSec : 0;
  return { segments, durationSec, source: "srt" };
}

export function allWords(alignment: Alignment): AlignedWord[] {
  return alignment.segments.flatMap((s) => s.words);
}
