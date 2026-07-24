const SIGNED_STORAGE_PATH = "/storage/v1/object/sign/";

function parseSignedStorageUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.pathname.includes(SIGNED_STORAGE_PATH) ? url : null;
  } catch {
    return null;
  }
}

/**
 * Office Online must fetch the document body. Supabase's `download` query
 * parameter forces Content-Disposition: attachment, which the viewer rejects.
 */
export function toInlineTelegramDocumentUrl(value: string): string {
  const url = parseSignedStorageUrl(value);
  if (!url) return value;
  url.searchParams.delete("download");
  return url.toString();
}

/** Keep a separate explicit download URL without changing the signed token. */
export function toDownloadTelegramDocumentUrl(
  value: string,
  fileName: string | null,
): string {
  const url = parseSignedStorageUrl(value);
  if (!url) return value;
  url.searchParams.set("download", fileName || "file");
  return url.toString();
}
