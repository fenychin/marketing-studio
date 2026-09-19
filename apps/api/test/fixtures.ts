import { spawn } from "node:child_process";
import { join } from "node:path";

/**
 * Deterministic ffmpeg fixtures shared by agent tests. Luma-distinct scene
 * colors (red 76 / white 255 / blue 29) so scene detection fires on both
 * cuts; sine bursts separated by 0.4s digital silence so silencedetect sees
 * three speech bursts aligned with the scenes.
 */

function ffmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", ...args], { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += String(d)));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(stderr) : reject(new Error(stderr.slice(-600)))));
  });
}

/** 8s reference ad: red(0-2.6) / white(2.6-5.2) / blue(5.2-8) + 3 speech bursts. */
export async function makeVoicedFixture(dir: string): Promise<string> {
  const path = join(dir, "voiced.mp4");
  await ffmpeg([
    "-y",
    "-f", "lavfi", "-i", "color=c=red:size=320x568:rate=15:duration=2.6",
    "-f", "lavfi", "-i", "color=c=white:size=320x568:rate=15:duration=2.6",
    "-f", "lavfi", "-i", "color=c=blue:size=320x568:rate=15:duration=2.8",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2.4",
    "-f", "lavfi", "-i", "aevalsrc=0:s=44100:d=0.4",
    "-f", "lavfi", "-i", "sine=frequency=660:duration=2.3",
    "-f", "lavfi", "-i", "aevalsrc=0:s=44100:d=0.4",
    "-f", "lavfi", "-i", "sine=frequency=880:duration=2.3",
    "-f", "lavfi", "-i", "aevalsrc=0:s=44100:d=0.2",
    "-filter_complex",
    "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v];[3:a][4:a][5:a][6:a][7:a][8:a]concat=n=6:v=0:a=1[a]",
    "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    path,
  ]);
  return path;
}

/** 6s silent still — no audio track, no scene changes. */
export async function makeSilentFixture(dir: string): Promise<string> {
  const path = join(dir, "silent.mp4");
  await ffmpeg([
    "-y",
    "-f", "lavfi", "-i", "color=c=gray:size=320x568:rate=15:duration=6",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    path,
  ]);
  return path;
}
