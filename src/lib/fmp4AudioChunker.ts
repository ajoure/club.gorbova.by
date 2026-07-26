// Streaming fragmented-MP4 (fMP4 / CMAF) audio chunker for browser transcription.
//
// Motivation: Kinescope отдаёт `audio_0_fragment.mp4` как fMP4/DASH-фрагмент —
// у него минимальный `moov` без полных `stbl` таблиц и цепочка `moof+mdat`.
// `AudioContext.decodeAudioData` такой контейнер не читает и загрузка ~150 МБ в
// один `AudioBuffer` в любом случае привела бы к OOM. Здесь мы:
//   1. Демуксим AAC-сэмплы через mp4box.js, освобождая обработанные буферы.
//   2. Декодируем AAC через WebCodecs `AudioDecoder`.
//   3. Копим ограниченное PCM-окно (~90 с) и сразу отдаём self-contained WAV
//      блоб через колбэк, освобождая PCM-буфер.
//
// Не меняет прогрессивный путь `wavChunker.ts` — используется только когда
// `sniffAudioContainer` определил контейнер как fMP4.

import { createFile, type ISOFile } from "mp4box";
import { encodeMonoPcmToWav, resampleMonoLinear } from "./wavChunker";

const TARGET_SAMPLE_RATE = 16_000;
const FEED_SLICE_BYTES = 4 * 1024 * 1024; // 4 MiB slices to mp4box
const PREFLIGHT_BYTES = 2 * 1024 * 1024;   // usually enough to see ftyp/moov/first moof

export type Fmp4TrackConfig = {
  trackId: number;
  codec: string;
  numberOfChannels: number;
  sampleRate: number;
  description: Uint8Array | null;
  timescale: number;
};

export type Fmp4Preflight = {
  container: "fmp4";
  totalDurationMs: number | null;
  track: Fmp4TrackConfig;
  webCodecsSupported: boolean;
  decoderConfigSupported: boolean;
};

export type SniffResult =
  | { container: "fmp4"; reason: string }
  | { container: "progressive"; reason: string };

// ---- container sniff -------------------------------------------------------

function findBox(buf: Uint8Array, fourcc: string, limit = buf.length): number {
  const a = fourcc.charCodeAt(0), b = fourcc.charCodeAt(1);
  const c = fourcc.charCodeAt(2), d = fourcc.charCodeAt(3);
  const cap = Math.min(buf.length - 3, limit);
  for (let i = 0; i < cap; i += 1) {
    if (buf[i] === a && buf[i + 1] === b && buf[i + 2] === c && buf[i + 3] === d) return i;
  }
  return -1;
}

export async function sniffAudioContainer(blob: Blob): Promise<SniffResult> {
  const head = new Uint8Array(await blob.slice(0, Math.min(blob.size, PREFLIGHT_BYTES)).arrayBuffer());
  const hasFtyp = findBox(head, "ftyp", 64) >= 0;
  if (!hasFtyp) return { container: "progressive", reason: "no_ftyp_progressive_or_non_mp4" };
  const hasMoof = findBox(head, "moof") >= 0;
  if (hasMoof) return { container: "fmp4", reason: "moof_present" };
  // ftyp present but no moof in first 2 MiB: presence of `stbl` inside moov
  // is a strong sign of a self-contained progressive MP4. Its absence with a
  // very small moov often indicates fMP4 whose first moof simply sits beyond
  // our probe window — treat that as fMP4 to stay safe.
  const hasStbl = findBox(head, "stbl") >= 0;
  return hasStbl
    ? { container: "progressive", reason: "stbl_present_progressive_mp4" }
    : { container: "fmp4", reason: "no_stbl_likely_fmp4" };
}

// ---- mp4box helpers --------------------------------------------------------

function toMp4boxBuffer(ab: ArrayBuffer, fileStart: number): ArrayBuffer {
  // mp4box.js accepts a plain ArrayBuffer with a `fileStart` prop attached.
  (ab as any).fileStart = fileStart;
  return ab;
}

function extractAudioSpecificConfig(mp4boxFile: ISOFile, trackId: number): Uint8Array | null {
  try {
    const trak: any = (mp4boxFile as any).getTrackById(trackId);
    const entries = trak?.mdia?.minf?.stbl?.stsd?.entries ?? [];
    for (const entry of entries) {
      const esds = entry?.esds;
      // esd → DecoderConfigDescriptor → DecoderSpecificInfo
      const dsi = esds?.esd?.descs?.[0]?.descs?.[0];
      if (dsi?.data) return dsi.data instanceof Uint8Array ? dsi.data : new Uint8Array(dsi.data);
    }
  } catch { /* ignore */ }
  return null;
}

function pickAudioTrack(info: any): any | null {
  const tracks = info?.audioTracks?.length ? info.audioTracks : (info?.tracks || []);
  for (const t of tracks) {
    const kind = t?.type || t?.track_type;
    const codec: string = String(t?.codec || "");
    if (kind === "audio" || (codec && codec.startsWith("mp4a"))) return t;
  }
  return null;
}

async function feedInitSegment(mp4boxFile: ISOFile, blob: Blob): Promise<any> {
  return new Promise<any>(async (resolve, reject) => {
    let resolved = false;
    (mp4boxFile as any).onReady = (info: any) => { if (!resolved) { resolved = true; resolve(info); } };
    (mp4boxFile as any).onError = (err: any) => { if (!resolved) { resolved = true; reject(new Error(String(err))); } };
    try {
      const cap = Math.min(blob.size, PREFLIGHT_BYTES);
      let offset = 0;
      while (offset < cap && !resolved) {
        const end = Math.min(offset + FEED_SLICE_BYTES, cap);
        const ab = await blob.slice(offset, end).arrayBuffer();
        (mp4boxFile as any).appendBuffer(toMp4boxBuffer(ab, offset));
        offset = end;
      }
      if (!resolved) reject(new Error("fmp4_moov_not_found_in_preflight_window"));
    } catch (e) {
      if (!resolved) reject(e);
    }
  });
}

// ---- preflight -------------------------------------------------------------

export async function preflightFmp4(blob: Blob): Promise<Fmp4Preflight> {
  const webCodecsSupported = typeof (globalThis as any).AudioDecoder !== "undefined";
  const mp4boxFile = createFile();
  const info = await feedInitSegment(mp4boxFile as any, blob);
  const audio = pickAudioTrack(info);
  if (!audio) throw new Error("fmp4_no_audio_track");
  const description = extractAudioSpecificConfig(mp4boxFile as any, audio.id);
  const timescale = Number(audio.timescale || audio.movie_timescale || 1000);
  const durationMs = audio.duration && audio.timescale
    ? Math.round((Number(audio.duration) / Number(audio.timescale)) * 1000)
    : (info?.duration && info?.timescale
        ? Math.round((Number(info.duration) / Number(info.timescale)) * 1000)
        : null);
  const track: Fmp4TrackConfig = {
    trackId: audio.id,
    codec: String(audio.codec || "mp4a.40.2"),
    numberOfChannels: Number(audio.audio?.channel_count || audio.channel_count || 2),
    sampleRate: Number(audio.audio?.sample_rate || audio.sample_rate || 44100),
    description,
    timescale,
  };

  let decoderConfigSupported = false;
  if (webCodecsSupported) {
    try {
      const supported = await (globalThis as any).AudioDecoder.isConfigSupported({
        codec: track.codec,
        sampleRate: track.sampleRate,
        numberOfChannels: track.numberOfChannels,
        ...(track.description ? { description: track.description } : {}),
      });
      decoderConfigSupported = !!supported?.supported;
    } catch {
      decoderConfigSupported = false;
    }
  }

  return {
    container: "fmp4",
    totalDurationMs: durationMs,
    track,
    webCodecsSupported,
    decoderConfigSupported,
  };
}

// ---- streaming chunker -----------------------------------------------------

export type StreamedWavChunk = {
  partIndex: number;
  startMs: number;
  endMs: number;
  blob: Blob;
};

export type StreamFmp4Options = {
  windowMs?: number;
  signal?: AbortSignal;
  onPart: (chunk: StreamedWavChunk) => Promise<void> | void;
  onProgress?: (readBytes: number, totalBytes: number) => void;
};

export type StreamFmp4Result = { totalDurationMs: number; partsEmitted: number };

/**
 * Stream a fMP4 audio blob → emit self-contained 16 kHz mono WAV windows.
 * Each emitted chunk is awaited before continuing, so the caller can upload
 * it and let the underlying Float32 buffer be released before the next
 * window is built. Decoded PCM is copied out per AudioData frame and the
 * frames are `close()`-d immediately; mp4box samples are released after each
 * onSamples call so the parser doesn't accumulate the whole file in RAM.
 */
export async function streamFmp4ToWavWindows(
  blob: Blob,
  opts: StreamFmp4Options,
): Promise<StreamFmp4Result> {
  const windowMs = opts.windowMs ?? 90_000;
  const pre = await preflightFmp4(blob);
  if (!pre.webCodecsSupported) throw new Error("webcodecs_unavailable");
  if (!pre.decoderConfigSupported) throw new Error("audio_decoder_config_unsupported");

  const { track } = pre;
  const AudioDecoderCtor: any = (globalThis as any).AudioDecoder;
  const EncodedAudioChunkCtor: any = (globalThis as any).EncodedAudioChunk;

  // Rolling mono PCM buffer at the source sample rate. When it reaches
  // windowSamplesSource, we resample to 16 kHz mono and emit a WAV.
  const windowSamplesSource = Math.floor((track.sampleRate * windowMs) / 1000);
  let pending: Float32Array = new Float32Array(0);
  let emittedMs = 0;
  let partIndex = 0;
  let decodeError: Error | null = null;

  const emissionQueue: Promise<void> = Promise.resolve();
  let queueTail: Promise<void> = emissionQueue;

  async function emitWindow(samples: Float32Array): Promise<void> {
    const resampled = resampleMonoLinear(samples, track.sampleRate, TARGET_SAMPLE_RATE);
    const wav = encodeMonoPcmToWav(resampled, TARGET_SAMPLE_RATE);
    const durationMs = Math.round((samples.length / track.sampleRate) * 1000);
    const chunk: StreamedWavChunk = {
      partIndex,
      startMs: emittedMs,
      endMs: emittedMs + durationMs,
      blob: wav,
    };
    partIndex += 1;
    emittedMs += durationMs;
    await opts.onPart(chunk);
  }

  function drainPending(force: boolean) {
    // Slice out full windows; keep remainder in `pending`.
    while (pending.length >= windowSamplesSource) {
      const slice = pending.subarray(0, windowSamplesSource);
      const rest = pending.subarray(windowSamplesSource);
      const copy = new Float32Array(slice); // detach from parent buffer
      pending = new Float32Array(rest);
      queueTail = queueTail.then(() => emitWindow(copy));
    }
    if (force && pending.length > 0) {
      const copy = new Float32Array(pending);
      pending = new Float32Array(0);
      queueTail = queueTail.then(() => emitWindow(copy));
    }
  }

  const decoder = new AudioDecoderCtor({
    output: (data: any /* AudioData */) => {
      try {
        // Downmix multi-channel to mono while copying each plane.
        const frames = data.numberOfFrames;
        const channels = data.numberOfChannels;
        const format: string = data.format || "f32-planar";
        const mono = new Float32Array(frames);
        if (format.endsWith("planar")) {
          for (let ch = 0; ch < channels; ch += 1) {
            const plane = new Float32Array(frames);
            data.copyTo(plane, { planeIndex: ch, format: "f32-planar" });
            for (let i = 0; i < frames; i += 1) mono[i] += plane[i];
          }
        } else {
          const interleaved = new Float32Array(frames * channels);
          data.copyTo(interleaved, { planeIndex: 0, format: "f32" });
          for (let i = 0; i < frames; i += 1) {
            let sum = 0;
            for (let ch = 0; ch < channels; ch += 1) sum += interleaved[i * channels + ch];
            mono[i] = sum;
          }
        }
        if (channels > 1) for (let i = 0; i < frames; i += 1) mono[i] /= channels;

        // Append to pending buffer.
        const merged = new Float32Array(pending.length + mono.length);
        merged.set(pending, 0);
        merged.set(mono, pending.length);
        pending = merged;
        drainPending(false);
      } finally {
        try { data.close(); } catch { /* ignore */ }
      }
    },
    error: (err: any) => { decodeError = err instanceof Error ? err : new Error(String(err)); },
  });

  decoder.configure({
    codec: track.codec,
    sampleRate: track.sampleRate,
    numberOfChannels: track.numberOfChannels,
    ...(track.description ? { description: track.description } : {}),
  });

  // Fresh mp4box instance for streaming pass.
  const mp4boxFile = createFile();
  const trackId = track.trackId;

  const samplesReady: Promise<void> = new Promise<void>((resolve, reject) => {
    (mp4boxFile as any).onError = (err: any) => reject(new Error(String(err)));
    (mp4boxFile as any).onReady = (info: any) => {
      const audio = pickAudioTrack(info) || { id: trackId };
      (mp4boxFile as any).setExtractionOptions(audio.id, null, { nbSamples: 200 });
      (mp4boxFile as any).onSamples = (id: number, _user: any, samples: any[]) => {
        if (id !== audio.id || decodeError) return;
        try {
          for (const s of samples) {
            const ts = Math.round((Number(s.cts) / Number(s.timescale || track.timescale)) * 1_000_000);
            const dur = Math.round((Number(s.duration) / Number(s.timescale || track.timescale)) * 1_000_000);
            const chunk = new EncodedAudioChunkCtor({
              type: s.is_sync ? "key" : "delta",
              timestamp: ts,
              duration: dur,
              data: s.data,
            });
            decoder.decode(chunk);
          }
        } catch (e) {
          decodeError = e instanceof Error ? e : new Error(String(e));
        } finally {
          const last = samples[samples.length - 1];
          if (last) (mp4boxFile as any).releaseUsedSamples(id, last.number + 1);
        }
      };
      (mp4boxFile as any).start();
      resolve();
    };
  });

  // Feed the blob in slices.
  let offset = 0;
  const total = blob.size;
  while (offset < total) {
    if (opts.signal?.aborted) throw new Error("cancelled_by_user");
    const end = Math.min(offset + FEED_SLICE_BYTES, total);
    const ab = await blob.slice(offset, end).arrayBuffer();
    (mp4boxFile as any).appendBuffer(toMp4boxBuffer(ab, offset));
    offset = end;
    opts.onProgress?.(offset, total);
    // Yield to event loop so onSamples/decoder output can run.
    await new Promise((r) => setTimeout(r, 0));
    if (decodeError) throw decodeError;
    // Wait for the emission queue to catch up so backpressure holds.
    await queueTail;
  }
  (mp4boxFile as any).flush();
  await samplesReady.catch(() => { /* onReady may have already fired */ });
  await decoder.flush();
  try { decoder.close(); } catch { /* ignore */ }
  if (decodeError) throw decodeError;

  drainPending(true);
  await queueTail;

  return { totalDurationMs: emittedMs, partsEmitted: partIndex };
}
