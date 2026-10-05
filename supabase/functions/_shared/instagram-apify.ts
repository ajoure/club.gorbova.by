import { INSTAGRAM_PILOT } from "./instagram-monitor.ts";

export type ApifyKind = "reels" | "comments";
export const APIFY_ACTORS = {
  reels: "apify~instagram-reel-scraper",
  comments: "apify~instagram-comment-scraper",
} as const;

/** Bounded official API requests. Tokens never travel in URLs or error text. */
export async function apifyRequest(
  token: string,
  path: string,
  body?: unknown,
): Promise<any> {
  const response = await fetch(`https://api.apify.com/v2/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(25_000),
    redirect: "error",
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`apify_http_${response.status}`);
  }
  if (!response.body) throw new Error("apify_empty_response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 2_000_000) throw new Error("apify_response_too_large");
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
export function apifyInput(kind: ApifyKind, source: string) {
  return kind === "reels"
    ? {
      username: [source],
      resultsLimit: INSTAGRAM_PILOT.maxReels,
      includeDownloadedVideo: true,
      includeTranscript: false,
      skipPinnedPosts: true,
    }
    : {
      directUrls: [source],
      resultsLimit: INSTAGRAM_PILOT.maxComments,
      includeNestedComments: false,
    };
}
export async function startApify(
  token: string,
  kind: ApifyKind,
  source: string,
): Promise<string> {
  const response = await apifyRequest(
    token,
    `acts/${
      APIFY_ACTORS[kind]
    }/runs?maxTotalChargeUsd=${INSTAGRAM_PILOT.maxRunUsd}&timeout=180&memory=1024`,
    apifyInput(kind, source),
  );
  const id = response?.data?.id;
  if (typeof id !== "string" || !/^[a-zA-Z0-9]+$/.test(id)) {
    throw new Error("apify_start_unknown");
  }
  return id;
}
export function providerId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9]+$/.test(value)) {
    throw new Error("invalid_provider_id");
  }
  return value;
}
export async function apifyRun(token: string, id: string): Promise<any> {
  return (await apifyRequest(token, `actor-runs/${providerId(id)}`)).data;
}
export async function apifyItems(
  token: string,
  dataset: string,
): Promise<any[]> {
  const result = await apifyRequest(
    token,
    `datasets/${providerId(dataset)}/items?clean=true&limit=50`,
  );
  if (!Array.isArray(result)) throw new Error("invalid_provider_dataset");
  return result;
}
