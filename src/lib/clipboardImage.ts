const IMAGE_EXTENSION_BY_MIME: Record<string, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function findClipboardFile(data: Pick<DataTransfer, "items" | "files">): File | null {
  for (const item of Array.from(data.items || [])) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file) return file;
  }

  return Array.from(data.files || [])[0] ?? null;
}

/**
 * Returns the first file from clipboard data. Clipboard screenshots usually
 * arrive as a generic `image.png`, so they receive a useful stable name.
 * Text-only paste returns null and must be left to the input's default handler.
 */
export function getClipboardFile(
  data: Pick<DataTransfer, "items" | "files">,
  timestamp = Date.now(),
): File | null {
  const file = findClipboardFile(data);
  if (!file) return null;

  const isGenericScreenshot =
    file.type.startsWith("image/") &&
    (!file.name || /^image\.(png|jpe?g|webp|gif)$/i.test(file.name));
  if (!isGenericScreenshot) return file;

  const extension = IMAGE_EXTENSION_BY_MIME[file.type] || "png";
  return new File([file], `screenshot-${timestamp}.${extension}`, {
    type: file.type || "image/png",
    lastModified: timestamp,
  });
}
