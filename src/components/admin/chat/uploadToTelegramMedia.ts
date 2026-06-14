import { supabase } from "@/integrations/supabase/client";
import * as tus from "tus-js-client";

// Файлы больше этого порога идут через TUS resumable upload (обходит лимиты gateway)
const TUS_THRESHOLD_BYTES = 6 * 1024 * 1024; // 6 MB
const TUS_CHUNK_SIZE = 6 * 1024 * 1024;

const PROJECT_REF =
  (import.meta.env.VITE_SUPABASE_PROJECT_ID as string) ||
  ((import.meta.env.VITE_SUPABASE_URL as string) || "")
    .replace("https://", "")
    .split(".")[0];

function sanitizeName(name: string): string {
  if (!name) return "file";
  const lastDot = name.lastIndexOf(".");
  const ext = lastDot > 0 ? name.slice(lastDot).toLowerCase() : "";
  const base = lastDot > 0 ? name.slice(0, lastDot) : name;
  const safe = base
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_.-]/g, "")
    .replace(/_+/g, "_")
    .slice(0, 80);
  return (safe || "file") + ext;
}

async function uploadViaTus(params: {
  file: File;
  bucket: string;
  filePath: string;
  contentType: string;
  token: string;
}): Promise<void> {
  const { file, bucket, filePath, contentType, token } = params;
  return new Promise((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: `https://${PROJECT_REF}.supabase.co/storage/v1/upload/resumable`,
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
    upload.findPreviousUploads().then((prev) => {
      if (prev.length > 0) upload.resumeFromPreviousUpload(prev[0]);
      upload.start();
    });
  });
}

/**
 * Список MIME, которые точно разрешены bucket'ом telegram-media.
 * Если у файла другой MIME (например, audio/webm от MediaRecorder в Chrome
 * или audio/ogg;codecs=opus из Firefox), Storage отклоняет загрузку с
 * "mime type ... is not supported". Голосовой/медиа-pipeline на сервере
 * всё равно повторно выводит MIME из имени файла и kind в guessMimeType,
 * поэтому безопасно отправлять такие файлы как application/octet-stream —
 * это и есть тип, явно разрешённый bucket'ом для произвольных бинарников.
 */
const BUCKET_ALLOWED_MIME = new Set<string>([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "audio/mpeg",
  "audio/ogg",
  "audio/mp4",
  "audio/wav",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream",
]);

function resolveUploadContentType(rawType: string | undefined | null): string {
  if (!rawType) return "application/octet-stream";
  // Отрезаем параметры кодека (audio/webm;codecs=opus → audio/webm)
  const base = rawType.split(";")[0].trim().toLowerCase();
  if (BUCKET_ALLOWED_MIME.has(base)) return base;
  return "application/octet-stream";
}

/**
 * Загружает файл в bucket telegram-media и возвращает storage_path.
 * Большие файлы автоматически идут через TUS (обход лимита тела запроса).
 */
export async function uploadToTelegramMedia(
  file: File,
  userId: string
): Promise<{ bucket: string; path: string }> {
  const bucket = "telegram-media";
  const safeName = sanitizeName(file.name);
  const path = `outbound/${userId}/${Date.now()}_${safeName}`;
  const contentType = resolveUploadContentType(file.type);

  // Если оригинальный MIME файла не входит в allowlist bucket'а (например
  // audio/webm;codecs=opus от MediaRecorder), пересобираем File с MIME,
  // равным безопасному contentType. Это нужно потому, что Supabase Storage
  // на сервере дополнительно сверяет actual MIME blob'а с allowed list,
  // и если он не совпадает с заявленным contentType — отклоняет загрузку
  // ("mime type ... is not supported"). Канонический MIME для Telegram
  // sendVoice всё равно выводится из имени файла и kind="voice" в
  // guessMimeType на edge function, поэтому downstream-логика не страдает.
  const needsRewrap =
    (file.type || "").split(";")[0].trim().toLowerCase() !== contentType;
  const uploadFile: File = needsRewrap
    ? new File([file], file.name, { type: contentType, lastModified: file.lastModified })
    : file;

  if (uploadFile.size > TUS_THRESHOLD_BYTES) {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error("Not authenticated");
    await uploadViaTus({ file: uploadFile, bucket, filePath: path, contentType, token });
  } else {
    const { error } = await supabase.storage.from(bucket).upload(path, uploadFile, {
      contentType,
      upsert: false,
    });
    if (error) throw error;
  }

  return { bucket, path };
}


