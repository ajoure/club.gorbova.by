import { instagramReleaseHealth } from "./release-health.ts";
import { CB21_RELEASE_DIGEST } from "../_shared/cb21-release.ts";
const base = "https://hdjgkjceownmmnrqqtuz.supabase.co";
function assert(ok: unknown) {
  if (!ok) throw new Error("assertion failed");
}
Deno.test("fixed GET health probes keep credentials in the server and return only attestation", async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init: init! });
    return Response.json({
      release_digest: CB21_RELEASE_DIGEST,
      untrusted: "fixture-private-token",
    });
  };
  const result = await instagramReleaseHealth(base, "Bearer fixture-user", {
    webhook: "fixture-webhook",
    media: "fixture-media",
  }, fetcher);
  assert(result.ready && requests.length === 4);
  for (const r of requests) {
    assert(
      r.init.method === "GET" && r.init.body === undefined &&
        r.init.redirect === "error",
    );
    assert(new URL(r.url).origin === base);
  }
  assert(
    new Headers(requests[1].init.headers).get("Authorization") ===
      "Bearer fixture-user",
  );
  assert(
    requests.filter((r) => new Headers(r.init.headers).has("Authorization"))
      .length === 1,
  );
  assert(
    new Headers(requests[2].init.headers).get(
      "x-telegram-bot-api-secret-token",
    ) === "fixture-webhook",
  );
  assert(
    new Headers(requests[3].init.headers).get("x-worker-token") ===
      "fixture-media",
  );
  assert(!JSON.stringify(result).includes("fixture-"));
});
Deno.test("unavailable secrets skip protected calls and cannot report release ready", async () => {
  let calls = 0;
  const result = await instagramReleaseHealth(
    base,
    "Bearer fixture-user",
    {},
    async () => {
      calls++;
      return Response.json({ release_digest: CB21_RELEASE_DIGEST });
    },
  );
  assert(
    calls === 2 && !result.ready &&
      result.probes.filter((p) => p.error_code === "credentials_unavailable")
          .length === 2,
  );
});
Deno.test("malformed or echoed private response fields never reach the requester", async () => {
  const result = await instagramReleaseHealth(
    base,
    "Bearer fixture-user",
    { webhook: "fixture-webhook", media: "fixture-media" },
    async () =>
      Response.json({
        release_digest: "fixture-private-token",
        error: "fixture-private-token",
      }),
  );
  assert(
    !result.ready && !JSON.stringify(result).includes("fixture-private-token"),
  );
});
Deno.test("oversized health response is cancelled and marked unavailable", async () => {
  let cancels = 0;
  const result = await instagramReleaseHealth(base, "Bearer fixture-user", {
    webhook: "fixture-webhook",
    media: "fixture-media",
  }, async () =>
    new Response(
      new ReadableStream({
        pull(c) {
          c.enqueue(new Uint8Array(5000));
        },
        cancel() {
          cancels++;
        },
      }),
    ));
  assert(!result.ready && cancels === 4);
});
Deno.test("untrusted runtime origins are refused before any authenticated request", async () => {
  let calls = 0;
  let refused = false;
  try {
    await instagramReleaseHealth(
      "http://localhost",
      "Bearer fixture-user",
      {},
      async () => {
        calls++;
        return Response.json({});
      },
    );
  } catch {
    refused = true;
  }
  assert(refused && calls === 0);
});
