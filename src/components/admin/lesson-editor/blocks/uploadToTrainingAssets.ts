import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import * as tus from "tus-js-client";

// Файлы больше этого порога идут через resumable TUS upload (обходит ~50MB limit API gateway)
const TUS_THRESHOLD_BYTES = 6 * 1024 * 1024; // 6 MB
const TUS_CHUNK_SIZE = 6 * 1024 * 1024; // Supabase требует ровно 6 MB chunks

async function uploadViaTus(params: {
  file: File | Blob;
  fileName: string;
  bucket: string;
  filePath: string;
  contentType: string;
  token: string;
  projectRef: string;
}): Promise<void> {
  const { file, fileName, bucket, filePath, contentType, token, projectRef } = params;
  return new Promise((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: `https://${projectRef}.supabase.co/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        authorization: `Bearer ${token}`,
        "x-upsert": "false",
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: bucket,
        objectName: filePath,
        contentType,
        cacheControl: "3600",
      },
      chunkSize: TUS_CHUNK_SIZE,
      onError: (error) => reject(error),
      onSuccess: () => resolve(),
    });
    // Возобновляем если есть прерванная загрузка того же файла
    upload.findPreviousUploads().then((previousUploads) => {
      if (previousUploads.length > 0) {
        upload.resumeFromPreviousUpload(previousUploads[0]);
      }
      upload.start();
    });
  });
}

/**
 * Вспомогательная функция: определяет MIME по расширению файла.
 * Используется как fallback если file.type пустой/нестандартный.
 */
function extensionToMime(ext: string): string {
  const map: Record<string, string> = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".ogg": "audio/ogg",
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".zip": "application/zip",
    ".rar": "application/x-rar-compressed",
    ".txt": "text/plain",
    ".csv": "text/csv",
    ".rtf": "application/rtf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".xmind": "application/x-xmind",
    ".mm": "application/x-freemind",
    ".mmap": "application/octet-stream",
    ".key": "application/x-iwork-keynote-sffkey",
    ".numbers": "application/x-iwork-numbers-sffnumbers",
    ".pages": "application/x-iwork-pages-sffpages",
    ".fig": "application/octet-stream",
  };
  return map[ext] || "application/octet-stream";
}

/**
 * Общая утилита загрузки файлов в бакет training-assets.
 *
 * Валидация: файл проходит если (mimeOk ИЛИ extOk).
 *
 * @param file            — загружаемый файл
 * @param folderPrefix    — папка внутри бакета (например "lesson-audio")
 * @param maxSizeMB       — максимальный размер в МБ
 * @param acceptMimePrefix — опциональный MIME-префикс для фильтрации
 * @param allowedExtensions — опциональный allowlist расширений
 * @param ownerId          — опциональный ID владельца (lessonId/moduleId) для изоляции пути
 *
 * @returns { publicUrl, storagePath } или null при ошибке
 */
export async function uploadToTrainingAssets(
  file: File,
  folderPrefix: string,
  maxSizeMB: number,
  acceptMimePrefix?: string,
  allowedExtensions?: string[],
  ownerId?: string
): Promise<{ publicUrl: string; storagePath: string } | null> {
  const fileExtension = "." + (file.name.split(".").pop()?.toLowerCase() || "");

  // Валидация типа: проходит если mimeOk ИЛИ extOk
  if (acceptMimePrefix || allowedExtensions) {
    const mimeOk = acceptMimePrefix ? file.type.startsWith(acceptMimePrefix) : false;
    const extOk = allowedExtensions ? allowedExtensions.includes(fileExtension) : false;

    if (!mimeOk && !extOk) {
      toast.error(`Неподдерживаемый формат файла`);
      return null;
    }
  }

  // Валидация размера ДО загрузки
  const maxSizeBytes = maxSizeMB * 1024 * 1024;
  if (file.size > maxSizeBytes) {
    toast.error(`Файл слишком большой. Максимум: ${maxSizeMB} МБ`);
    return null;
  }

  // Уникальное имя файла
  const uniqueId =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).substring(2);

  // Безопасное имя файла
  const safeName = file.name
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .substring(0, 64);

  // Нормализуем ownerId: trim(), пробельная строка → как отсутствие
  const owner = (typeof ownerId === "string" ? ownerId : "").trim();

  // STOP-лог: ожидали lessonId для lesson-* папки, но не получили
  if (
    (folderPrefix === "lesson-audio" ||
      folderPrefix === "lesson-files" ||
      folderPrefix === "lesson-images") &&
    !owner
  ) {
    console.warn(
      `[uploadToTrainingAssets] ownerId missing or empty for "${folderPrefix}" (expected lessonId). File will be stored without ownership prefix.`
    );
  }

  // Формируем путь: folderPrefix/[owner/]timestamp-uuid-name
  const filePath = owner
    ? `${folderPrefix}/${owner}/${Date.now()}-${uniqueId}-${safeName}`
    : `${folderPrefix}/${Date.now()}-${uniqueId}-${safeName}`;

  // BUGFIX: приоритет extensionToMime над file.type (браузер может отдать text/rtf вместо application/rtf)
  const mapped = extensionToMime(fileExtension);
  const resolvedContentType =
    mapped !== "application/octet-stream" ? mapped : (file.type || mapped);

  // BUGFIX: Supabase SDK uses File.type internally, ignoring contentType option.
  // Re-create File from bytes with correct MIME to guarantee proper Content-Type.
  const uploadBody: File | Blob =
    file.type !== resolvedContentType
      ? new File([await file.arrayBuffer()], file.name, { type: resolvedContentType })
      : file;

  const { error: uploadError } = await supabase.storage
    .from("training-assets")
    .upload(filePath, uploadBody, { upsert: false, contentType: resolvedContentType });

  if (uploadError) {
    console.error("Upload error:", uploadError);
    toast.error(`Ошибка загрузки: ${uploadError.message}`);
    return null;
  }

  const { data: urlData } = supabase.storage
    .from("training-assets")
    .getPublicUrl(filePath);

  return { publicUrl: urlData.publicUrl, storagePath: filePath };
}

/**
 * Преобразует Google Drive ссылку /file/d/ID/view → прямой URL для скачивания.
 */
export function convertGoogleDriveUrl(url: string): {
  converted: string | null;
  isGoogleDrive: boolean;
  fileId: string | null;
} {
  const gdMatch = url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (!gdMatch) {
    return { converted: null, isGoogleDrive: false, fileId: null };
  }
  const fileId = gdMatch[1];
  const converted = `https://drive.google.com/uc?export=download&id=${fileId}`;
  return { converted, isGoogleDrive: true, fileId };
}

/**
 * Форматирует размер файла в удобочитаемый вид.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Строгий allowlist для guard-проверки
const STORAGE_ALLOWED_PREFIXES = ["lesson-audio/", "lesson-files/", "lesson-images/", "student-uploads/", "ai-covers/", "training-covers/", "lesson-covers/"];

/**
 * Извлекает storagePath из publicUrl Supabase Storage.
 * Возвращает null если URL не наш или путь не проходит guards.
 */
export function extractStoragePathFromPublicUrl(url: string): string | null {
  if (!url) return null;

  // Паттерн: /storage/v1/object/public/training-assets/<path>
  const match = url.match(/\/storage\/v1\/object\/public\/training-assets\/(.+)/);
  if (!match) return null;

  const path = match[1];

  // Guard: только наши префиксы
  if (!STORAGE_ALLOWED_PREFIXES.some((p) => path.startsWith(p))) return null;
  // Guard: запрет traversal
  if (path.includes("..") || path.includes("//")) return null;

  return path;
}

/**
 * Результат удаления файлов из training-assets.
 */
export interface DeleteTrainingAssetsResult {
  ok: boolean;
  requested_count: number;
  allowed_count: number;
  blocked_count: number;
  deleted_count: number;
  blocked_paths: string[];
  deleted_paths: string[];
  error?: string;
  skipped_shared_count?: number;
  shared_paths?: string[];
  attempted_delete_count?: number;
}

const EMPTY_RESULT: DeleteTrainingAssetsResult = {
  ok: true,
  requested_count: 0,
  allowed_count: 0,
  blocked_count: 0,
  deleted_count: 0,
  blocked_paths: [],
  deleted_paths: [],
};

/**
 * Безопасное удаление файлов из training-assets через Edge Function.
 * Возвращает структурированный результат для STOP-guards.
 */
export async function deleteTrainingAssets(
  paths: string[],
  entity?: { type: string; id: string },
  reason = "client_delete"
): Promise<DeleteTrainingAssetsResult> {
  if (!paths || paths.length === 0) return { ...EMPTY_RESULT };

  // Фильтрация на клиенте — только наши префиксы
  const safePaths = paths.filter(
    (p) =>
      p &&
      typeof p === "string" &&
      !p.includes("..") &&
      !p.includes("//") &&
      STORAGE_ALLOWED_PREFIXES.some((prefix) => p.startsWith(prefix))
  );

  const result: DeleteTrainingAssetsResult = {
    ok: false,
    requested_count: safePaths.length,
    allowed_count: 0,
    blocked_count: 0,
    deleted_count: 0,
    blocked_paths: [],
    deleted_paths: [],
  };

  if (safePaths.length === 0) {
    result.ok = true;
    return result;
  }

  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) {
      result.error = "No session token";
      console.warn("[deleteTrainingAssets] No session token, skipping delete");
      return result;
    }

    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    const fnUrl = `https://${projectId}.supabase.co/functions/v1/training-assets-delete`;
    const baseBody = { paths: safePaths, reason, entity: entity || undefined };

    // Шаг 1: dry_run
    const dryRes = await fetch(fnUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...baseBody, mode: "dry_run" }),
    });
    const dryData = await dryRes.json().catch(() => null);

    if (!dryRes.ok || !dryData) {
      result.error = `dry_run failed: ${dryRes.status}`;
      console.error("[deleteTrainingAssets] dry_run failed:", dryData);
      return result;
    }

    result.allowed_count = dryData.allowed_count ?? 0;
    result.blocked_count = dryData.blocked_count ?? 0;
    result.blocked_paths = dryData.blocked_paths ?? [];

    // STOP только при реальных blocked paths (безопасность/ownership)
    if ((result.blocked_count ?? 0) > 0) {
      result.error = `Blocked paths: ${(result.blocked_paths ?? []).join(", ")}`;
      console.warn("[deleteTrainingAssets] Blocked:", result.blocked_paths);
      return result;
    }

    // Пробросить shared-данные из dry_run
    result.skipped_shared_count = dryData.skipped_shared_count ?? 0;
    result.shared_paths = dryData.shared_paths ?? [];

    // Если allowed_count=0 и нет blocked — файлы shared или уже отсутствуют, это OK
    if (result.allowed_count <= 0) {
      console.info("[deleteTrainingAssets] allowed_count=0, no blocked — skipping execute");
      result.ok = true;
      return result;
    }

    // Shared paths info (не блокируем)
    if (dryData.skipped_shared_count > 0) {
      console.info("[deleteTrainingAssets] Shared assets skipped:", dryData.shared_paths);
    }

    // Шаг 2: execute
    const execRes = await fetch(fnUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...baseBody, mode: "execute" }),
    });
    const execData = await execRes.json().catch(() => null);

    if (!execRes.ok || !execData) {
      result.error = `execute failed: ${execRes.status}`;
      console.error("[deleteTrainingAssets] Execute failed:", execData);
      return result;
    }

    result.deleted_count = execData.deleted_count ?? execData.allowed_count ?? 0;
    result.deleted_paths = execData.deleted_paths ?? [];
    result.attempted_delete_count = execData.attempted_delete_count ?? result.allowed_count;
    const execErrors: string[] = execData.errors ?? [];

    // Partial delete: если есть реальные ошибки storage — это ошибка
    if (execErrors.length > 0) {
      result.error = `Storage errors: ${execErrors.join("; ")}`;
      console.error("[deleteTrainingAssets]", result.error);
      return result;
    }

    // Если deleted < allowed но ошибок нет — файлы уже отсутствовали (копии уроков)
    if (result.deleted_count < result.allowed_count) {
      console.warn(
        `[deleteTrainingAssets] Partial: deleted=${result.deleted_count}, allowed=${result.allowed_count} — some files may not exist in storage`
      );
      // НЕ блокируем — файлы могли быть уже удалены или это копия урока
    }

    result.ok = true;
    return result;
  } catch (err) {
    result.error = err instanceof Error ? err.message : "Unknown error";
    console.error("[deleteTrainingAssets] Failed:", err);
    return result;
  }
}
