import { spawn } from "child_process";
import ffmpegPath from "ffmpeg-static";
import { log } from "../../utils/log.js";

export type AudioFormat = "oggopus" | "mp3" | "wav";

function toMp3(input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      "pipe:0",
      "-vn",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-b:a",
      "64k",
      "-f",
      "mp3",
      "pipe:1",
    ];
    runFfmpeg(args, input, "audio→mp3", resolve, reject);
  });
}

function toOggOpus(input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      "pipe:0",
      "-vn",
      "-ar",
      "24000",
      "-ac",
      "1",
      "-c:a",
      "libopus",
      "-b:a",
      "32k",
      "-f",
      "ogg",
      "pipe:1",
    ];
    runFfmpeg(args, input, "audio→oggopus", resolve, reject);
  });
}

/**
 * Convert raw PCM (s16le, 48kHz mono — OpenRouter's default) to OGG Opus.
 * PCM has no container/header, so ffmpeg must be told the format explicitly.
 */
export function pcmToOggOpus(input: Buffer, sampleRate = 48000, channels = 1): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "s16le",
      "-ar",
      String(sampleRate),
      "-ac",
      String(channels),
      "-i",
      "pipe:0",
      "-vn",
      "-ar",
      "24000",
      "-ac",
      "1",
      "-c:a",
      "libopus",
      "-b:a",
      "32k",
      "-f",
      "ogg",
      "pipe:1",
    ];
    runFfmpeg(args, input, "pcm→oggopus", resolve, reject);
  });
}

function runFfmpeg(
  args: string[],
  input: Buffer,
  label: string,
  resolve: (b: Buffer) => void,
  reject: (e: Error) => void
): void {
  if (!ffmpegPath) {
    reject(new Error("ffmpeg binary not available"));
    return;
  }

  const proc = spawn(ffmpegPath, args, { stdio: ["pipe", "pipe", "pipe"] });
  const chunks: Buffer[] = [];
  let stderr = "";

  proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
  proc.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  proc.on("error", (err) => reject(err));

  proc.on("close", (code) => {
    if (code === 0) {
      resolve(Buffer.concat(chunks));
    } else {
      const msg = stderr.trim() || `exit code ${code}`;
      log.error(`ffmpeg ${label} failed: ${msg}`);
      reject(new Error(`ffmpeg failed: ${msg}`));
    }
  });

  proc.stdin.on("error", (err) => reject(err));
  proc.stdin.end(input);
}

/**
 * Normalize arbitrary audio bytes (ogg opus, mp3, m4a, …) to the requested
 * target format via the bundled ffmpeg-static binary. Used to bridge between
 * Telegram's voice format (ogg opus) and STT/TTS providers' preferred formats.
 */
export function transcodeAudio(input: Buffer, target: AudioFormat): Promise<Buffer> {
  switch (target) {
    case "mp3":
      return toMp3(input);
    case "oggopus":
      return toOggOpus(input);
    case "wav":
      return Promise.reject(new Error("wav transcoding not implemented"));
    default:
      return Promise.reject(new Error(`unsupported audio format: ${target}`));
  }
}

export function oggOpusDurationSeconds(input: Buffer): number {
  let offset = 0;
  let lastGranule = 0n;
  while (offset + 27 <= input.length) {
    if (input.subarray(offset, offset + 4).toString("ascii") !== "OggS") return 0;
    const granule = input.readBigUInt64LE(offset + 6);
    if (granule !== 0xffff_ffff_ffff_ffffn && granule > lastGranule) {
      lastGranule = granule;
    }
    const segmentCount = input[offset + 26];
    const segmentTableEnd = offset + 27 + segmentCount;
    if (segmentTableEnd > input.length) return 0;
    let bodyBytes = 0;
    for (let i = offset + 27; i < segmentTableEnd; i += 1) bodyBytes += input[i];
    const nextOffset = segmentTableEnd + bodyBytes;
    if (nextOffset > input.length || nextOffset <= offset) return 0;
    offset = nextOffset;
  }
  return Number(lastGranule) / 48_000;
}
