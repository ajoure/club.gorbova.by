import { CB21_RELEASE_DIGEST } from "../_shared/cb21-release.ts";

/** Read-only fixed health probes. Secrets stay in the Edge runtime. */
export async function instagramReleaseHealth(
  baseUrl: string,
  requesterAuthorization: string,
  secrets: { webhook?: string; media?: string },
  fetcher: typeof fetch = fetch,
) {
  const base = new URL(baseUrl);
  if (
    base.protocol !== "https:" ||
    !/^[a-z]{20}\.supabase\.co$/.test(base.hostname) || base.username ||
    base.password
  ) {
    throw new Error("invalid_runtime_url");
  }
  const targets = [
    { name: "sales-runtime-worker", headers: {} },
    {
      name: "sales-runtime-control",
      headers: { Authorization: requesterAuthorization },
    },
    {
      name: "telegram-webhook",
      headers: secrets.webhook
        ? { "x-telegram-bot-api-secret-token": secrets.webhook }
        : null,
    },
    {
      name: "telegram-media-worker",
      headers: secrets.media ? { "x-worker-token": secrets.media } : null,
    },
  ];
  const probes = await Promise.all(targets.map(async (target) => {
    if (!target.headers) {
      return {
        function: target.name,
        status: null,
        matches: false,
        error_code: "credentials_unavailable",
      };
    }
    let status: number | null = null;
    try {
      const response = await fetcher(
        `${base.origin}/functions/v1/${target.name}?health=cb21`,
        {
          method: "GET",
          headers: target.headers as Record<string, string>,
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        },
      );
      status = response.status;
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        return { function: target.name, status, matches: false };
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const p = await reader.read();
          if (p.done) break;
          size += p.value.length;
          if (size > 4096) throw new Error("oversized_health_response");
          chunks.push(p.value);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const c of chunks) {
        bytes.set(c, offset);
        offset += c.length;
      }
      const body = JSON.parse(new TextDecoder().decode(bytes));
      // Never echo a mismatched field: an error response could contain a secret.
      return {
        function: target.name,
        status,
        matches: body?.release_digest === CB21_RELEASE_DIGEST,
      };
    } catch {
      return {
        function: target.name,
        status,
        matches: false,
        error_code: "probe_failed",
      };
    }
  }));
  return {
    expected_digest: CB21_RELEASE_DIGEST,
    ready: probes.every((p) => p.status === 200 && p.matches),
    probes,
  };
}
