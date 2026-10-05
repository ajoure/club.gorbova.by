import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  allowedInstagramMediaUrl,
  fetchInstagramMedia,
  INSTAGRAM_PILOT,
  instagramCsvCell,
  instagramPostUrl,
  instagramUsername,
} from "./instagram-monitor.ts";

Deno.test("public profile and reel inputs reject credentials and unrelated URLs", () => {
  assertEquals(instagramUsername("@Katerina.Gorbova"), "katerina.gorbova");
  assertEquals(
    instagramUsername("https://www.instagram.com/katerina.gorbova/"),
    "katerina.gorbova",
  );
  for (
    const value of [
      "https://instagram.com.evil.test/katerina",
      "https://u:p@instagram.com/katerina",
      "https://instagram.com/p/DaQmyN4uJ-g/",
      "127.0.0.1/x",
      "accounts",
    ]
  ) {
    assertThrows(() => instagramUsername(value));
  }
  assertEquals(
    instagramPostUrl("https://www.instagram.com/reel/DaQmyN4uJ-g/?tracking=x"),
    "https://www.instagram.com/p/DaQmyN4uJ-g/",
  );
  assertThrows(() => instagramPostUrl("https://evil.test/p/DaQmyN4uJ-g/"));
});

Deno.test("media fetch cannot follow user-controlled or internal hosts", () => {
  allowedInstagramMediaUrl(
    "https://api.apify.com/v2/key-value-stores/abc/records/video.mp4",
  );
  allowedInstagramMediaUrl("https://scontent.cdninstagram.com/video.mp4");
  for (
    const value of [
      "http://scontent.cdninstagram.com/a",
      "https://127.0.0.1/a",
      "https://cdninstagram.com.evil.test/a",
      "https://u:p@scontent.cdninstagram.com/a",
      "https://api.apify.com/v2/users/me",
      "https://scontent.cdninstagram.com:8443/a",
    ]
  ) {
    assertThrows(() => allowedInstagramMediaUrl(value));
  }
});

Deno.test("untrusted captions and comments do not execute spreadsheet formulas", () => {
  assertEquals(
    instagramCsvCell('=HYPERLINK("bad")'),
    '"\'=HYPERLINK(""bad"")"',
  );
  assertEquals(instagramCsvCell("\t@SUM(1)"), '"\'\t@SUM(1)"');
  assertEquals(instagramCsvCell("Текст, с запятой"), '"Текст, с запятой"');
});

Deno.test("redirect to an internal server is rejected before a second request", async () => {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = () => {
    requests++;
    return Promise.resolve(
      new Response(null, {
        status: 302,
        headers: { location: "https://127.0.0.1/private" },
      }),
    );
  };
  try {
    await assertRejects(
      () => fetchInstagramMedia("https://scontent.cdninstagram.com/reel.mp4"),
      Error,
      "invalid_media_url",
    );
    assertEquals(requests, 1);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("stream size is bounded even when content-length is absent", async () => {
  const original = globalThis.fetch;
  let cancelled = false;
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new Uint8Array(INSTAGRAM_PILOT.maxMediaBytes + 1),
            );
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "content-type": "video/mp4" } },
      ),
    );
  try {
    await assertRejects(
      () => fetchInstagramMedia("https://scontent.cdninstagram.com/reel.mp4"),
      Error,
      "media_too_large",
    );
    assertEquals(cancelled, true);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("expired media error closes its stream and does not reveal the URL", async () => {
  const original = globalThis.fetch;
  let cancelled = false;
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
        { status: 403 },
      ),
    );
  try {
    await assertRejects(
      () =>
        fetchInstagramMedia(
          "https://scontent.cdninstagram.com/reel.mp4?sig=redacted",
        ),
      Error,
      "media_fetch_403",
    );
    assertEquals(cancelled, true);
  } finally {
    globalThis.fetch = original;
  }
});
