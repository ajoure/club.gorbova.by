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
  const contentType = file.type || "application/octet-stream";

  if (file.size > TUS_THRESHOLD_BYTES) {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error("Not authenticated");
    await uploadViaTus({ file, bucket, filePath: path, contentType, token });
  } else {
    const { error } = await supabase.storage.from(bucket).upload(path, file, {
      contentType,
      upsert: false,
    });
    if (error) throw error;
  }

  return { bucket, path };
}
