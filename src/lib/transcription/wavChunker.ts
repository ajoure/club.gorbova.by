// Client-side audio chunker for the client-assisted transcription flow.
//
// Decodes an arbitrary browser-supported audio blob (mp3, m4a, mp4, webm,
// wav, ogg …) into raw PCM via the Web Audio API, downmixes to mono,
// downsamples to a target sample rate (default 16 kHz — plenty for
// speech-to-text), then emits a sequence of standalone WAV blobs with
// each part sized well below the Lovable AI Gateway 24 MiB per-request
// cap. Each returned chunk carries its start/end timestamps so the
// server can persist part boundaries for resume.
//
// The chunker intentionally holds only one PCM buffer at a time in
// memory during encoding: for a 3h45m recording at 16 kHz mono this
// stays around ~430 MiB decoded once, which browser tabs handle. The
// wav encoding produces short-lived Blob objects that are released as
// each part is uploaded.

export type AudioChunk = {
  index: number;
  startMs: number;
  endMs: number;
  wav: Blob;
  bytes: number;
};

const DEFAULT_TARGET_SAMPLE_RATE = 16000;
// 16 kHz mono 16-bit PCM ≈ 32 KB/s → 8 min ≈ 15 MB (safely below 24 MiB cap).
const DEFAULT_WINDOW_SECONDS = 480;

export async function decodeAudioBlob(blob: Blob): Promise<AudioBuffer> {
  const arrayBuffer = await blob.arrayBuffer();
  const AudioCtx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
  const ctx = new AudioCtx();
  try {
    return await ctx.decodeAudioData(arrayBuffer);
  } finally {
    void ctx.close();
  }
}

function downmixToMono(audioBuffer: AudioBuffer): Float32Array {
  const { numberOfChannels, length } = audioBuffer;
  if (numberOfChannels === 1) return audioBuffer.getChannelData(0).slice();
  const mono = new Float32Array(length);
  for (let ch = 0; ch < numberOfChannels; ch += 1) {
    const data = audioBuffer.getChannelData(ch);
    for (let i = 0; i < length; i += 1) mono[i] += data[i];
  }
  const scale = 1 / numberOfChannels;
  for (let i = 0; i < length; i += 1) mono[i] *= scale;
  return mono;
}

function resamplePcm(input: Float32Array, inputRate: number, targetRate: number): Float32Array {
  if (inputRate === targetRate) return input;
  const ratio = inputRate / targetRate;
  const outLength = Math.floor(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const srcIndex = i * ratio;
    const i0 = Math.floor(srcIndex);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = srcIndex - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

function encodeWavMono16(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i += 1) view.setUint8(offset + i, str.charCodeAt(i));
  };

  const dataSize = samples.length * 2;
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

export type ChunkPlan = {
  totalParts: number;
  windowMs: number;
  durationMs: number;
  sampleRate: number;
  bounds: Array<{ index: number; startMs: number; endMs: number }>;
};

export function planChunks(
  audioBuffer: AudioBuffer,
  { windowSeconds = DEFAULT_WINDOW_SECONDS, targetSampleRate = DEFAULT_TARGET_SAMPLE_RATE }: {
    windowSeconds?: number;
    targetSampleRate?: number;
  } = {},
): ChunkPlan {
  const durationMs = Math.max(0, Math.round(audioBuffer.duration * 1000));
  const windowMs = Math.max(30_000, Math.floor(windowSeconds * 1000));
  const totalParts = Math.max(1, Math.ceil(durationMs / windowMs));
  const bounds = Array.from({ length: totalParts }, (_, index) => ({
    index,
    startMs: index * windowMs,
    endMs: Math.min(durationMs, (index + 1) * windowMs),
  }));
  return { totalParts, windowMs, durationMs, sampleRate: targetSampleRate, bounds };
}

export function extractChunk(
  audioBuffer: AudioBuffer,
  plan: ChunkPlan,
  index: number,
): AudioChunk {
  const bound = plan.bounds[index];
  if (!bound) throw new Error(`chunk_index_out_of_range:${index}`);
  const inputRate = audioBuffer.sampleRate;
  const mono = downmixToMono(audioBuffer);
  const startSample = Math.floor((bound.startMs / 1000) * inputRate);
  const endSample = Math.min(mono.length, Math.floor((bound.endMs / 1000) * inputRate));
  const slice = mono.subarray(startSample, endSample);
  const resampled = resamplePcm(slice, inputRate, plan.sampleRate);
  const wav = encodeWavMono16(resampled, plan.sampleRate);
  return { index, startMs: bound.startMs, endMs: bound.endMs, wav, bytes: wav.size };
}
