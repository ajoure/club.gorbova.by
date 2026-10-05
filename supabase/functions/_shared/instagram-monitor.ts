/** Provider-independent validation. Only public Instagram sources are accepted. */
export const INSTAGRAM_PILOT = {
  maxRunUsd: 0.25,
  maxMonthUsd: 4,
  maxReels: 2,
  maxComments: 15,
  maxMediaBytes: 30 * 1024 * 1024,
  maxDurationSeconds: 300,
} as const;

export function instagramUsername(input: unknown): string {
  if (typeof input !== "string") throw new Error("invalid_profile");
  let value = input.trim();
  if (/^https?:\/\//i.test(value)) {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !["instagram.com", "www.instagram.com"].includes(url.hostname) ||
      url.username || url.password
    ) {
      throw new Error("invalid_profile");
    }
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 1) throw new Error("invalid_profile");
    value = parts[0];
  }
  value = value.replace(/^@/, "").toLowerCase();
  if (
    !/^[a-z0-9_][a-z0-9_.]{0,29}$/.test(value) ||
    ["p", "reel", "reels", "stories", "explore", "accounts", "direct"].includes(
      value,
    )
  ) {
    throw new Error("invalid_profile");
  }
  return value;
}

export function instagramPostUrl(input: unknown): string {
  if (typeof input !== "string") throw new Error("invalid_post");
  const url = new URL(input);
  if (
    url.protocol !== "https:" ||
    !["instagram.com", "www.instagram.com"].includes(url.hostname) ||
    url.username || url.password
  ) {
    throw new Error("invalid_post");
  }
  const match = url.pathname.match(/^\/(?:p|reel)\/([A-Za-z0-9_-]{5,64})\/?$/);
  if (!match) throw new Error("invalid_post");
  return `https://www.instagram.com/p/${match[1]}/`;
}

/** Media URLs are used server-side only, never retained in DB or logs. */
export function allowedInstagramMediaUrl(input: string): URL {
  const url = new URL(input);
  if (
    url.protocol !== "https:" || url.username || url.password ||
    (url.port && url.port !== "443")
  ) throw new Error("invalid_media_url");
  const host = url.hostname.toLowerCase();
  const isCdn = host.endsWith(".cdninstagram.com") ||
    host.endsWith(".fbcdn.net");
  const isApify = host === "api.apify.com" &&
    /^\/v2\/key-value-stores\/[a-zA-Z0-9]+\/records\/[a-zA-Z0-9_.%\-]+$/.test(
      url.pathname,
    );
  if (!isCdn && !isApify) throw new Error("invalid_media_url");
  return url;
}

export async function fetchInstagramMedia(
  url: string,
): Promise<{ bytes: Uint8Array; mime: string }> {
  let target = allowedInstagramMediaUrl(url);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetch(target, {
      redirect: "manual",
      signal: AbortSignal.timeout(45_000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      if (redirects === 3) throw new Error("media_redirect_limit");
      const location = response.headers.get("location");
      if (!location) throw new Error("media_redirect_missing");
      target = allowedInstagramMediaUrl(new URL(location, target).href);
      continue;
    }
    if (!response.ok || !response.body) {
      throw new Error(`media_fetch_${response.status}`);
    }
    const mime = (response.headers.get("content-type") || "").split(";")[0]
      .trim();
    if (
      !mime.startsWith("video/") && !mime.startsWith("audio/") &&
      mime !== "application/octet-stream"
    ) {
      await response.body.cancel();
      throw new Error("invalid_media_type");
    }
    if (
      Number(response.headers.get("content-length")) >
        INSTAGRAM_PILOT.maxMediaBytes
    ) {
      await response.body.cancel();
      throw new Error("media_too_large");
    }
    const reader = response.body.getReader();
    const parts: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.length;
        if (length > INSTAGRAM_PILOT.maxMediaBytes) {
          throw new Error("media_too_large");
        }
        parts.push(chunk.value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    if (length < 4096) throw new Error("media_empty");
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
    return { bytes, mime };
  }
  throw new Error("media_fetch_failed");
}

/** CSV formula injection must stay inert when the export is opened in Excel. */
export function instagramCsvCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^[\s\uFEFF]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
