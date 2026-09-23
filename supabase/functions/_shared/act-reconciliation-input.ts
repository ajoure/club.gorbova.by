const ALLOWED_EXTENSIONS = new Set([
  "pdf", "docx", "xls", "xlsx", "csv", "txt", "jpg", "jpeg", "png", "webp",
]);
const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_TEXT_CHARS = 160_000;
const MAX_IMAGES = 16;
const MAX_IMAGE_BYTES = 18 * 1024 * 1024;

type IncomingImage = { base64?: unknown; filename?: unknown; mimeType?: unknown };
type UnsupportedFileInfo = { name: string; reason?: string; extension?: string };

function extensionOf(name: string): string {
  const match = /\.([^.]+)$/.exec(name.toLowerCase());
  return match?.[1] || "";
}

function estimatedBase64Bytes(value: string): number {
  const payload = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
  return Math.floor(payload.length * 0.75);
}

export function validateActReconciliationInput(input: {
  fileNames?: unknown;
  fileContents?: unknown;
  images?: unknown;
  unsupportedFiles?: unknown;
}): string | null {
  if (!Array.isArray(input.fileNames) || input.fileNames.length !== 2 || input.fileNames.some((name) => typeof name !== "string" || !name.trim())) {
    return "Загрузите ровно два акта сверки: первый от вашей организации, второй — от контрагента.";
  }
  const fileNames = input.fileNames as string[];
  const unsupportedExtensions = fileNames.filter((name) => !ALLOWED_EXTENSIONS.has(extensionOf(name)));
  if (unsupportedExtensions.length) {
    return `Не поддерживается формат: ${unsupportedExtensions.join(", ")}. Используйте PDF, XLSX/XLS, CSV, DOCX, TXT, JPG, PNG или WebP.`;
  }

  const unsupported = Array.isArray(input.unsupportedFiles)
    ? input.unsupportedFiles as UnsupportedFileInfo[]
    : [];
  if (unsupported.length) {
    return `Не удалось прочитать: ${unsupported.map((file) => file.name).join(", ")}. Сохраните эти акты в PDF с текстовым слоем, XLSX или CSV и загрузите снова.`;
  }

  const fileContents = typeof input.fileContents === "string" ? input.fileContents : "";
  if (fileContents.length > MAX_TEXT_CHARS) {
    return "Акты слишком объёмные для одного анализа. Сформируйте акты за меньший период или загрузите XLSX/CSV без лишних листов.";
  }

  if (input.images != null && !Array.isArray(input.images)) return "Некорректные данные файлов. Загрузите акты повторно.";
  const images = (Array.isArray(input.images) ? input.images : []) as IncomingImage[];
  if (images.length > MAX_IMAGES) {
    return `Слишком много страниц сканов: максимум ${MAX_IMAGES} за один анализ. Сократите период или используйте PDF с текстом, XLSX либо CSV.`;
  }
  let imageBytes = 0;
  for (const image of images) {
    if (typeof image.base64 !== "string" || typeof image.filename !== "string") {
      return "Не удалось прочитать одно из изображений. Загрузите акты повторно.";
    }
    const matchedMime = /^data:([^;]+);base64,/i.exec(image.base64)?.[1];
    const mime = matchedMime || (typeof image.mimeType === "string" ? image.mimeType : "");
    if (!ALLOWED_IMAGE_MIME.has(mime)) {
      return "Для сканов поддерживаются только JPG, PNG и WebP.";
    }
    imageBytes += estimatedBase64Bytes(image.base64);
  }
  if (imageBytes > MAX_IMAGE_BYTES) {
    return "Сканы слишком объёмные. Уменьшите разрешение или загрузите PDF с текстом, XLSX либо CSV.";
  }

  if (!fileContents.trim() && images.length === 0) {
    return "Не удалось извлечь содержимое актов. Загрузите PDF с текстовым слоем, XLSX, CSV или чёткие сканы.";
  }
  return null;
}
