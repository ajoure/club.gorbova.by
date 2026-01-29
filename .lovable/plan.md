План: Исправление импорта видеоответов (PATCH 1–12)

0) Факт из CSV ошибок (корень проблемы)

При XLSX.read(..., { cellDates: true }) библиотека превращает и даты, и таймкоды в Date:
	•	answerDate: Fri Jan 19 2024 00:00:00 GMT+0100...
	•	timecode: Sat Dec 30 1899 01:03:00 GMT+0124... (таймкод как “время суток” от базы 1899)

Значит, парсер обязан поддерживать Date и для дат, и для таймкодов — иначе получаем 00:00 и “видео с начала”.

⸻

PATCH-1: buildKinescopeUrlWithTimecode — оставить как есть ✅

Файл: src/hooks/useKbQuestions.ts
Функция должна:
	•	убирать /embed/
	•	убирать существующий t=
	•	добавлять ?t=<seconds> (share-url формат)

⸻

PATCH-2: parseTimecode — добавить поддержку Date

Файл: src/hooks/useKbQuestions.ts

Цель: если таймкод пришёл Date (1899-12-30 HH:MM:SS), извлечь время и вернуть секунды.

export function parseTimecode(
  timecode: string | number | Date | undefined | null
): number | null {
  if (timecode === null || timecode === undefined) return null;

  // XLSX cellDates: true -> Date (1899-12-30 HH:MM:SS)
  if (timecode instanceof Date && !Number.isNaN(timecode.getTime())) {
    // используем UTC-компоненты, чтобы не ловить странные TZ (типа GMT+0124)
    const h = timecode.getUTCHours();
    const m = timecode.getUTCMinutes();
    const s = timecode.getUTCSeconds();
    const total = h * 3600 + m * 60 + s;
    return total > 0 ? total : null;
  }

  // number (Excel time fraction / decimal hours / seconds) — текущая логика
  if (typeof timecode === "number") {
    if (!Number.isFinite(timecode) || timecode <= 0) return null;
    if (timecode < 1) return Math.round(timecode * 86400);
    if (timecode <= 24) return Math.round(timecode * 3600);
    return Math.round(timecode);
  }

  // string mm:ss / hh:mm:ss — текущая логика
  const cleaned = String(timecode).trim();
  if (!cleaned) return null;

  const parts = cleaned.split(":").map((p) => parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return null;

  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}


⸻

PATCH-3: parseDate — убрать UTC-сдвиг, date-only без потери дня

Файл: src/pages/admin/AdminKbImport.tsx

Цель: получить YYYY-MM-DD корректно:
	•	Date из XLSX → локальные компоненты, без toISOString()
	•	Excel serial → считать в UTC и форматировать UTC-компонентами

const parseDate = (value: string | number | Date | null | undefined): string => {
  if (value === null || value === undefined || value === "") return "";

  // Date object from XLSX (cellDates:true)
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  const asString = String(value).trim();

  // Excel serial
  if (typeof value === "number" || /^\d{5}$/.test(asString)) {
    const serial = typeof value === "number" ? value : parseInt(asString, 10);
    if (!Number.isFinite(serial) || serial <= 0) return "";

    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const dt = new Date(excelEpoch.getTime() + serial * 86400000);

    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const d = String(dt.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  // DD.MM.YY / DD.MM.YYYY
  const m = asString.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (m) {
    const [, dd, mm, yy] = m;
    const yyyy = yy.length === 2 ? `20${yy}` : yy;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }

  // ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(asString)) return asString.slice(0, 10);

  return "";
};


⸻

PATCH-4: Группировка по episode_number — оставить как есть ✅

Файл: src/pages/admin/AdminKbImport.tsx
Группировка только Map<number, GroupedEpisode>.

⸻

PATCH-5: Строгий parseEpisodeNumber — оставить как есть ✅

Ограничение диапазона (например MAX_EPISODE_NUMBER = 200) обязательно.

⸻

PATCH-6: Сохранение timecode_seconds без потери при повторном импорте

Файл: src/pages/admin/AdminKbImport.tsx → importEpisode() → upsert kb_questions

Цель: не затирать существующее timecode_seconds, если новый импорт дал null.

Алгоритм:
	1.	finalTimecodeSeconds = q.timecodeSeconds
	2.	Если finalTimecodeSeconds === null:
	•	прочитать существующую запись (lesson_id, question_number)
	•	если в ней timecode_seconds NOT NULL → оставить его

let finalTimecodeSeconds = q.timecodeSeconds;

if (finalTimecodeSeconds === null) {
  const { data: existing } = await supabase
    .from("kb_questions")
    .select("timecode_seconds")
    .eq("lesson_id", lessonId)
    .eq("question_number", q.questionNumber)
    .maybeSingle();

  if (existing?.timecode_seconds !== null && existing?.timecode_seconds !== undefined) {
    finalTimecodeSeconds = existing.timecode_seconds;
  }
}

await supabase.from("kb_questions").upsert(
  {
    lesson_id: lessonId,
    episode_number: episode.episodeNumber,
    question_number: q.questionNumber,
    title: q.title,
    full_question: q.fullQuestion || null,
    tags: q.tags.length ? q.tags : null,
    kinescope_url: q.kinescopeUrl,
    timecode_seconds: finalTimecodeSeconds ?? null,
    answer_date: q.answerDate || episode.answerDate,
  },
  { onConflict: "lesson_id,question_number" }
);


⸻

PATCH-7: Клик по вопросу — всегда открывать нормализованный URL с t=

Файл: src/pages/LibraryLesson.tsx

Заменить текущий window.open(\${q.kinescope_url}?t=…`)` на:

import { buildKinescopeUrlWithTimecode } from "@/hooks/useKbQuestions";

onClick={() => {
  if (!q.timecode_seconds) return;
  const url = buildKinescopeUrlWithTimecode(q.kinescope_url, q.timecode_seconds);
  if (url !== "#") window.open(url, "_blank");
}}


⸻

PATCH-8: “Просмотр ответа” — тоже через buildKinescopeUrlWithTimecode

Файл: там, где формируется переход “просмотр ответа” (кнопка/ссылка).

Правило одно: никаких ручных ?t=, только buildKinescopeUrlWithTimecode().

⸻

PATCH-9: Обложки/превью — выключить «позорную» генерацию текста, поставить безопасный источник

Файл: src/pages/admin/AdminKbImport.tsx

Цель: после импорта превью не пустое, и без кривого русского текста.

Правило:
	•	НЕ вызывать генерацию обложки, которая рисует текст с ошибками.
	•	Делать так:
	•	если у урока нет thumbnail_url → ставить дефолтную статичную обложку проекта (asset/URL в конфиге)
	•	(опционально позже) заменить на thumbnail из Kinescope по API, но это отдельный интеграционный PATCH

const DEFAULT_THUMBNAIL_URL = "/assets/lesson-default-cover.png";

await supabase
  .from("training_lessons")
  .update({ thumbnail_url: DEFAULT_THUMBNAIL_URL })
  .eq("id", lessonId);


⸻

PATCH-10: Описания — только справочник + детерминированный fallback (без “AI-генерации”)

Файл: src/pages/admin/AdminKbImport.tsx

Логика:
	•	если EPISODE_SUMMARIES[episodeNumber] есть → использовать
	•	иначе fallback из первых 3–6 тем вопросов (чистка, без ошибок)

const fallbackDescription = episode.questions
  .filter(q => q.title)
  .slice(0, 6)
  .map(q => q.title.trim().replace(/\s+/g, " ").replace(/[?!.;,]+$/g, ""))
  .join(", ");


⸻

PATCH-11: UI-формат даты строго DD.MM.YYYY

Файлы:
	•	src/components/training/LessonCard.tsx
	•	src/pages/Knowledge.tsx

Правило:
	•	хранение: YYYY-MM-DD в БД
	•	показ: dd.MM.yyyy (например через date-fns + parseISO)

⸻

PATCH-12: STOP-предохранители — усиление Test Run

Файл: src/pages/admin/AdminKbImport.tsx

Дополнить: блокировать Test Run, если нет валидных вопросов:

const validCount = episode.questions.filter(q => q.title).length;
if (validCount === 0) critical.push("Нет валидных вопросов");


⸻

Файлы для изменения (итог)

Файл	Патчи
src/hooks/useKbQuestions.ts	2
src/pages/admin/AdminKbImport.tsx	3, 6, 9, 10, 12
src/pages/LibraryLesson.tsx	7, 8
src/components/training/LessonCard.tsx	11
src/pages/Knowledge.tsx	11


⸻

DoD (Definition of Done)
	1.	74 выпуска (не 86)
	2.	Таймкоды в вопросах: не 00:00, а реальные mm:ss / hh:mm:ss
	3.	Даты без сдвига: 07.01.2024 (не “вчера/завтра”)
	4.	Клик по вопросу открывает видео с нужного таймкода (URL содержит ?t=)
	5.	Формат даты в UI: DD.MM.YYYY
	6.	Превью урока не пустое и без кривого текста (дефолтная обложка)

SQL-пруфы

SELECT COUNT(DISTINCT episode_number) FROM kb_questions; -- 74

SELECT episode_number, COUNT(*), MIN(timecode_seconds), MAX(timecode_seconds)
FROM kb_questions
WHERE episode_number = 74
GROUP BY episode_number;