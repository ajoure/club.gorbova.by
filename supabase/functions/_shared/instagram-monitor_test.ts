import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  allowedInstagramMediaUrl,
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
