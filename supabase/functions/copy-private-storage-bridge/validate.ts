// Destination pinning for the temporary copy bridge. See index.ts.

export const COPY_ORIGIN = "https://ypwsuumurrtkxatoyqhk.supabase.co";
export const ALLOWED_BUCKETS = new Set([
  "telegram-media",
  "live-event-media",
  "documents",
  "instagram-monitor-media",
  "ticket-attachments",
  "document-external-attachments",
  "student-submissions",
  "prompt-attachments",
  "contact-files",
  "documents-templates",
  "charter-documents",
  "tariff-media",
]);
export const MAX_ITEMS = 10;

export type Item = { bucket: string; name: string; upload_url: string; content_type?: string };

// Optional stored mimetype of the source object (the download response may differ).
export function validContentType(value: unknown): string | null {
  return typeof value === "string" && /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(value) && value.length <= 127
    ? value
    : null;
}

export function encodePath(name: string): string {
  return name.split("/").map(encodeURIComponent).join("/");
}

export function validUploadUrl(item: Item): URL | null {
  let url: URL;
  try {
    url = new URL(item.upload_url);
  } catch {
    return null;
  }
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  const expected = `/storage/v1/object/upload/sign/${item.bucket}/${item.name}`;
  if (url.origin !== COPY_ORIGIN || path !== expected || url.username || url.password || url.hash) return null;
  const params = [...url.searchParams.keys()];
  if (params.length !== 1 || params[0] !== "token" || !url.searchParams.get("token")) return null;
  return url;
}

