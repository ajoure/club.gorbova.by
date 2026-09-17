export const BANK_STATEMENT_MAX_FILES = 5;
export const BANK_STATEMENT_MAX_IMAGES = 5;
export const BANK_STATEMENT_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const BANK_STATEMENT_MAX_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024;

const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

type IncomingImage = { base64?: unknown; filename?: unknown; mimeType?: unknown };
type UnsupportedFile = { name?: unknown; reason?: unknown; extension?: unknown };

function base64ByteLength(value: string): number {
  const payload = value.replace(/^data:[^;]+;base64,/i, "").replace(/\s/g, "");
  if (!payload || !/^[a-z0-9+/]*={0,2}$/i.test(payload)) return -1;
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.floor((payload.length * 3) / 4) - padding;
}

/**
 * Browser checks improve UX; this guard is the authoritative boundary for the
 * Edge Function, including callers which bypass the UI.
 */
export function validateBankStatementInput(input: {
  fileNames: unknown;
  images: unknown;
  unsupportedFiles: unknown;
}): string | null {
  const fileNames = Array.isArray(input.fileNames) ? input.fileNames : [];
  if (!fileNames.length || fileNames.length > BANK_STATEMENT_MAX_FILES || fileNames.some((name) => typeof name !== "string" || !name.trim())) {
    return `Можно загрузить от 1 до ${BANK_STATEMENT_MAX_FILES} файлов выписки.`;
  }

  const unsupportedFiles = Array.isArray(input.unsupportedFiles) ? input.unsupportedFiles as UnsupportedFile[] : [];
  if (unsupportedFiles.length) {
    const names = unsupportedFiles
      .map((file) => typeof file.name === "string" ? file.name : "файл")
      .slice(0, BANK_STATEMENT_MAX_FILES)
      .join(", ");
    return `Формат не удалось надёжно прочитать: ${names}. Сохраните выписку в PDF, XLSX/XLS, CSV, TXT, DOCX или как изображение.`;
  }

  const images = Array.isArray(input.images) ? input.images as IncomingImage[] : [];
  if (images.length > BANK_STATEMENT_MAX_IMAGES) {
    return `Можно приложить не более ${BANK_STATEMENT_MAX_IMAGES} изображений или PDF.`;
  }

  let totalBytes = 0;
  for (const image of images) {
    if (typeof image.base64 !== "string" || typeof image.filename !== "string" || !image.filename.trim()) {
      return "Не удалось прочитать один из приложенных файлов.";
    }
    const mimeType = typeof image.mimeType === "string"
      ? image.mimeType.toLowerCase()
      : /^data:([^;]+);base64,/i.exec(image.base64)?.[1]?.toLowerCase();
    if (!mimeType || !SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
      return "Поддерживаются только PDF, JPG, PNG и WebP.";
    }
    const bytes = base64ByteLength(image.base64);
    if (bytes < 0 || bytes > BANK_STATEMENT_MAX_IMAGE_BYTES) {
      return "Один из файлов слишком большой или повреждён.";
    }
    totalBytes += bytes;
  }
  if (totalBytes > BANK_STATEMENT_MAX_TOTAL_IMAGE_BYTES) {
    return "Общий объём изображений и PDF слишком большой. Разделите выписку на несколько запусков.";
  }

  return null;
}
