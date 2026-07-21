// Decode any audio Blob and slice it into complete 16 kHz mono WAV windows.
// Each window is a self-contained, decodable file — this avoids MediaRecorder
// timeslice fragments and the iOS Safari mp4/webm corruption traps documented
// in the Lovable AI STT knowledge.

export type WavChunk = {
  partIndex: number;
  startMs: number;
  endMs: number;
  blob: Blob;
};

export type WavChunkPlan = {
  totalDurationMs: number;
  windowMs: number;
  sampleRate: number;
  chunks: WavChunk[];
};

const TARGET_SAMPLE_RATE = 16_000;

async function decodeAudioBlob(blob: Blob): Promise<AudioBuffer> {
  const arrayBuffer = await blob.arrayBuffer();
  const AC: typeof AudioContext =
    (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AC) throw new Error("web_audio_api_unavailable");
  const ctx = new AC();
  try {
    return await ctx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    try { await ctx.close(); } catch { /* ignore */ }
  }
}

function toMono16k(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels;
  const src = buffer.getChannelData(0);
  const mixed = new Float32Array(src.length);
  mixed.set(src);
  for (let c = 1; c < channels; c += 1) {
    const chan = buffer.getChannelData(c);
    for (let i = 0; i < mixed.length; i += 1) mixed[i] += chan[i];
  }
  if (channels > 1) {
    for (let i = 0; i < mixed.length; i += 1) mixed[i] /= channels;
  }
  return resampleMonoLinear(mixed, buffer.sampleRate, TARGET_SAMPLE_RATE);
}

// Linear-interpolation mono resampler. Exported so the fMP4 streaming
// chunker can reuse the same downsampling path as the progressive one.
export function resampleMonoLinear(mono: Float32Array, srcRate: number, dstRate: number): Float32Array {
  const ratio = srcRate / dstRate;
  if (ratio <= 1.0001 && ratio >= 0.9999) return mono;
  const outLen = Math.floor(mono.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i += 1) {
    const srcIndex = i * ratio;
    const i0 = Math.floor(srcIndex);
    const i1 = Math.min(i0 + 1, mono.length - 1);
    const frac = srcIndex - i0;
    out[i] = mono[i0] * (1 - frac) + mono[i1] * frac;
  }
  return out;
}

// Encode a mono Float32 PCM buffer as a standard 16-bit WAV blob.
export function encodeMonoPcmToWav(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const dataBytes = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i += 1) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataBytes, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    s = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(offset, s, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

// Backwards-compatible internal alias used below.
const encodeWav = encodeMonoPcmToWav;


export async function chunkAudioBlobToWavWindows(
  blob: Blob,
  windowMs = 90_000,
): Promise<WavChunkPlan> {
  const decoded = await decodeAudioBlob(blob);
  const mono = toMono16k(decoded);
  const totalDurationMs = Math.round((mono.length / TARGET_SAMPLE_RATE) * 1000);
  const samplesPerWindow = Math.floor((TARGET_SAMPLE_RATE * windowMs) / 1000);
  const chunks: WavChunk[] = [];
  const totalWindows = Math.max(1, Math.ceil(mono.length / samplesPerWindow));
  for (let i = 0; i < totalWindows; i += 1) {
    const startSample = i * samplesPerWindow;
    const endSample = Math.min(mono.length, startSample + samplesPerWindow);
    const slice = mono.subarray(startSample, endSample);
    const wav = encodeWav(slice, TARGET_SAMPLE_RATE);
    chunks.push({
      partIndex: i,
      startMs: Math.round((startSample / TARGET_SAMPLE_RATE) * 1000),
      endMs: Math.round((endSample / TARGET_SAMPLE_RATE) * 1000),
      blob: wav,
    });
  }
  return { totalDurationMs, windowMs, sampleRate: TARGET_SAMPLE_RATE, chunks };
}

// Convenience for tests / fixtures: build a synthetic sine-tone WAV directly.
export function buildSyntheticWav({
  durationMs,
  frequencyHz = 440,
  sampleRate = TARGET_SAMPLE_RATE,
}: { durationMs: number; frequencyHz?: number; sampleRate?: number }): Blob {
  const totalSamples = Math.floor((sampleRate * durationMs) / 1000);
  const samples = new Float32Array(totalSamples);
  for (let i = 0; i < totalSamples; i += 1) {
    samples[i] = Math.sin((2 * Math.PI * frequencyHz * i) / sampleRate) * 0.25;
  }
  return encodeWav(samples, sampleRate);
}
