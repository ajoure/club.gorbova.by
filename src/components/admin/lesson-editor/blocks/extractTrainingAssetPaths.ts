/**
 * Утилита для извлечения storage_path из JSON-контента блоков и прогресса.
 * Используется при cleanup (reset progress, delete lesson).
 */

const ALLOWED_PREFIXES = ["lesson-audio/", "lesson-files/", "lesson-images/", "student-uploads/", "ai-covers/", "training-covers/", "lesson-covers/"];

export type TrainingAssetBucket = "training-assets" | "student-submissions";

export interface TrainingAssetReference {
  bucket: TrainingAssetBucket;
  path: string;
}

function isValidPath(p: unknown): p is string {
  if (!p || typeof p !== "string") return false;
  if (p.includes("..") || p.includes("//") || p.startsWith("/")) return false;
  return ALLOWED_PREFIXES.some((prefix) => p.startsWith(prefix));
}

/** Паттерны для извлечения storagePath из Supabase Storage URL (public, signed, raw) */
const STORAGE_URL_PATTERNS = [
  /\/storage\/v1\/object\/public\/training-assets\/(.+)/,
  /\/storage\/v1\/object\/sign\/training-assets\/([^?]+)/,
  /\/storage\/v1\/object\/training-assets\/(.+)/,
];

/**
 * Пытается извлечь storagePath из publicUrl / signedUrl.
 * Поддерживает public, sign и raw форматы.
 * Применяет decodeURIComponent для корректной обработки %20 и т.п.
 */
function extractPathFromUrl(url: unknown): string | null {
  if (!url || typeof url !== "string") return null;
  for (const pattern of STORAGE_URL_PATTERNS) {
    const match = url.match(pattern);
    if (match) {
      try {
        const path = decodeURIComponent(match[1]);
        if (isValidPath(path)) return path;
      } catch {
        const path = match[1];
        if (isValidPath(path)) return path;
      }
    }
  }
  return null;
}

/**
 * Рекурсивно извлекает все storage_path / storagePath / url из произвольного JSON.
 * Обходит ВСЕ ключи объекта рекурсивно (не только items/files/content).
 * Поддерживает:
 * - block content: { storagePath: "..." } или { url: "https://.../training-assets/..." }
 * - gallery items: { items: [{ storagePath: "..." }] }
 * - student progress response: { files: [{ storage_path: "..." }] }
 * - legacy progress: { file: { storage_path: "..." } } или { storage_path: "..." }
 */
export function extractTrainingAssetReferences(input: unknown): TrainingAssetReference[] {
  const found = new Map<string, TrainingAssetReference>();

  const add = (path: string, rawBucket: unknown) => {
    const bucket: TrainingAssetBucket = rawBucket === "student-submissions"
      ? "student-submissions"
      : "training-assets";
    found.set(`${bucket}:${path}`, { bucket, path });
  };

  function walk(obj: unknown): void {
    if (!obj || typeof obj !== "object") return;

    if (Array.isArray(obj)) {
      for (const item of obj) walk(item);
      return;
    }

    const record = obj as Record<string, unknown>;

    // Direct path fields
    if (isValidPath(record.storagePath)) add(record.storagePath, record.storage_bucket);
    if (isValidPath(record.storage_path)) add(record.storage_path, record.storage_bucket);

    // Public URL → storagePath extraction (audio/file blocks store url)
    const urlPath = extractPathFromUrl(record.url);
    if (urlPath) add(urlPath, record.storage_bucket);

    // Recurse into ALL values of the object
    for (const key of Object.keys(record)) {
      const val = record[key];
      if (val && typeof val === "object") {
        walk(val);
      }
    }
  }

  walk(input);
  return Array.from(found.values()).sort((a, b) => `${a.bucket}:${a.path}`.localeCompare(`${b.bucket}:${b.path}`));
}

/** Совместимый список путей для существующих материалов публичного bucket. */
export function extractTrainingAssetPaths(input: unknown): string[] {
  return Array.from(new Set(extractTrainingAssetReferences(input).map((reference) => reference.path))).sort();
}

/**
 * Извлекает пути из массива lesson_blocks (каждый имеет .content).
 */
export function extractPathsFromBlocks(blocks: Array<{ content: unknown }>): string[] {
  const allPaths = new Set<string>();
  for (const block of blocks) {
    for (const p of extractTrainingAssetPaths(block.content)) {
      allPaths.add(p);
    }
  }
  return Array.from(allPaths).sort();
}

/**
 * Извлекает пути из массива user_lesson_progress записей (каждая имеет .response).
 */
export function extractPathsFromProgress(progressRecords: Array<{ response: unknown }>): string[] {
  const allPaths = new Set<string>();
  for (const rec of progressRecords) {
    for (const p of extractTrainingAssetPaths(rec.response)) {
      allPaths.add(p);
    }
  }
  return Array.from(allPaths).sort();
}
