// PATCH-CONTACT-CENTER-VOICE-MESSAGES-V1
// Shared, provably independent helpers for audio recording.
// Used by AdminVoiceRecorder (admin Telegram chat). The support VoiceRecorder
// intentionally remains untouched to avoid regressing tickets; if both sides
// need to converge later, this module is the single source of MIME selection.

export const MAX_VOICE_BYTES = 50 * 1024 * 1024; // 50 MB — Telegram sendVoice limit
export const MAX_VOICE_DURATION_SEC = 300; // 5 min

/**
 * Pick the best recorder MIME the current browser actually supports.
 * Real values observed:
 *   - Chrome desktop / Android Chrome → audio/webm;codecs=opus
 *   - Firefox → audio/ogg;codecs=opus
 *   - Safari macOS / iOS → audio/mp4 (AAC)
 *
 * IMPORTANT: never lie about the format. Whatever MediaRecorder produces is
 * what we send to Telegram. D4 probes proved Telegram accepts all three as
 * sendVoice → result.voice. No fake re-encoding to OGG.
 */
export function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/ogg;codecs=opus",
    "audio/mp4;codecs=mp4a.40.2", // AAC-LC (Safari)
    "audio/mp4",
    "audio/webm",
  ];
  for (const c of candidates) {
    try {
      if (
        typeof MediaRecorder.isTypeSupported === "function" &&
        MediaRecorder.isTypeSupported(c)
      ) {
        return c;
      }
    } catch {
      // ignore
    }
  }
  return undefined;
}

/** Pick a file extension that honestly matches the produced MIME. */
export function extFromRecorderMime(mime: string | undefined | null): string {
  const m = (mime || "").toLowerCase();
  if (m.includes("ogg")) return "ogg";
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "m4a";
  if (m.includes("mpeg")) return "mp3";
  return "webm";
}

export function formatRecorderTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m.toString().padStart(2, "0")}:${r.toString().padStart(2, "0")}`;
}

export function isMediaRecorderAvailable(): boolean {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia
  );
}
