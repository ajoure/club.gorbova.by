// ============================================================================
// _shared/transcribe-audio.ts
// ----------------------------------------------------------------------------
// Общий helper для транскрибации и AI-сводки аудио через Lovable AI Gateway
// (Gemini). Используется:
//   - supabase/functions/call-transcribe-summarize (записи звонков VOCHI)
//   - supabase/functions/voice-note-transcribe-summarize (голосовые в ленте)
// Никакой параллельной второй реализации быть не должно.
// ============================================================================

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash"; // audio in -> text out

export const MIN_AUDIO_BYTES = 4096; // Guard от заглушек Vochi/пустой записи
export const MIN_DURATION_SEC = 5;   // Guard от галлюцинаций на тишине

export function audioFormatFromMime(mime: string): string {
  const m = (mime || "").toLowerCase();
  if (m.includes("wav")) return "wav";
  if (m.includes("m4a")) return "m4a";
  if (m.includes("mp4")) return "mp4";
  if (m.includes("ogg") || m.includes("opus")) return "ogg";
  if (m.includes("webm")) return "webm";
  if (m.includes("flac")) return "flac";
  return "mp3";
}

export async function fetchAudioBase64(
  url: string,
  extraHeaders?: Record<string, string>,
): Promise<{ base64: string; contentType: string; bytes: number }> {
  const res = await fetch(url, { headers: extraHeaders });
  if (!res.ok) {
    throw new Error(`recording_fetch_failed: ${res.status} ${res.statusText}`);
  }
  const contentType = res.headers.get("content-type") || "audio/mpeg";
  const buf = new Uint8Array(await res.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + chunk)));
  }
  const base64 = btoa(binary);
  return { base64, contentType, bytes: buf.byteLength };
}

export function base64FromBytes(buf: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

async function callGateway(apiKey: string, messages: any[]): Promise<string> {
  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages }),
  });
  if (res.status === 429) throw new Error("ai_rate_limited");
  if (res.status === 402) throw new Error("ai_credits_exhausted");
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ai_gateway_${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

export interface TranscribeOptions {
  apiKey: string;
  base64: string;
  format: string;
  /** Тип контента: "call" = разговор, "voice_note" = голосовая заметка, "webinar" = эфир. */
  kind?: "call" | "voice_note" | "webinar";
}

export interface TranscribeResult {
  transcript: string;
  summary: string;
}

export async function transcribeAndSummarize(opts: TranscribeOptions): Promise<TranscribeResult> {
  const { apiKey, base64, format, kind = "call" } = opts;

  const transcribeSystem = kind === "voice_note"
    ? "Ты — точный транскрибатор голосовых сообщений на русском языке. Верни только дословный текст. Не добавляй комментариев, ролей и метаданных."
    : kind === "webinar"
      ? "Ты — точный транскрибатор образовательных эфиров на русском языке. Верни полный текст от начала до конца, не сокращай и не пересказывай. Сохраняй абзацы, помечай смену говорящего только когда она очевидна. Неразборчивые места обозначай [неразборчиво], но не придумывай слова. Не добавляй сводку или комментарии."
      : "Ты — точный транскрибатор телефонных разговоров на русском языке. Верни только дословный текст разговора с разметкой по ролям (Оператор:/Клиент:) если можно определить. Не добавляй комментариев.";

  const summarySystem = kind === "voice_note"
    ? "Ты — ассистент CRM. По расшифровке голосового сообщения от менеджера/клиента составь краткое резюме (1-3 строки) на русском: суть сообщения и, если есть, следующий шаг. Без приветствий, без лишнего."
    : kind === "webinar"
      ? "Ты — редактор образовательных материалов. По полной расшифровке эфира составь точную сводку на русском в 2–4 абзаца. Не добавляй фактов, которых нет в тексте."
      : "Ты — ассистент CRM. По расшифровке звонка составь краткое резюме (3-6 строк) на русском: тема, договорённости, следующий шаг. Без приветствий, без лишнего.";

  const transcript = await callGateway(apiKey, [
    { role: "system", content: transcribeSystem },
    {
      role: "user",
      content: [
        { type: "text", text: kind === "voice_note" ? "Расшифруй это голосовое сообщение полностью." : kind === "webinar" ? "Расшифруй этот эфир полностью, без сокращений." : "Расшифруй этот телефонный разговор полностью." },
        { type: "input_audio", input_audio: { data: base64, format } },
      ],
    },
  ]);

  const summary = await callGateway(apiKey, [
    { role: "system", content: summarySystem },
    { role: "user", content: `Расшифровка:\n\n${transcript}` },
  ]);

  return { transcript: transcript.trim(), summary: summary.trim() };
}
