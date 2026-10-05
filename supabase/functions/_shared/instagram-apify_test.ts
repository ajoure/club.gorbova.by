import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { apifyRequest, startApify } from "./instagram-apify.ts";

Deno.test("Apify start enforces price and result bounds, keeps token out of URL", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (_input, init) => {
    const url = new URL(String(_input));
    const body = JSON.parse(String(init?.body));
    assertEquals(url.origin, "https://api.apify.com");
    assertEquals(url.searchParams.get("maxTotalChargeUsd"), "0.25");
    assertEquals(url.searchParams.has("token"), false);
    assertEquals(
      new Headers(init?.headers).get("authorization"),
      "Bearer fixture-only",
    );
    assertEquals(body.resultsLimit, 2);
    assertEquals(body.includeDownloadedVideo, true);
    assertEquals(body.includeTranscript, false);
    return Promise.resolve(Response.json({ data: { id: "fixtureRun" } }));
  };
  try {
    assertEquals(
      await startApify("fixture-only", "reels", "katerina.gorbova"),
      "fixtureRun",
    );
  } finally {
    globalThis.fetch = original;
  }
});
Deno.test("provider error bodies never appear in diagnostics", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(
      new Response("private provider diagnostic", { status: 403 }),
    );
  try {
    await assertRejects(
      () => apifyRequest("fixture-only", "actor-runs/fixture"),
      Error,
      "apify_http_403",
    );
  } finally {
    globalThis.fetch = original;
  }
});
Deno.test("oversized dataset is cancelled even without content-length", async () => {
  const original = globalThis.fetch;
  let cancelled = false;
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(2_000_001));
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
    );
  try {
    await assertRejects(
      () => apifyRequest("fixture-only", "datasets/fixture/items"),
      Error,
      "apify_response_too_large",
    );
    assertEquals(cancelled, true);
  } finally {
    globalThis.fetch = original;
  }
});
