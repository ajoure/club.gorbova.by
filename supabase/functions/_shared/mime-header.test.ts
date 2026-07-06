import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { encodeMimeHeader, encodeAddressHeader } from "./mime-header.ts";

Deno.test("encodeMimeHeader: pure ASCII returned as-is", () => {
  assertEquals(encodeMimeHeader("Gorbova"), "Gorbova");
  assertEquals(encodeMimeHeader("Your OTP: 123456"), "Your OTP: 123456");
});

Deno.test("encodeMimeHeader: Cyrillic wrapped in =?UTF-8?B?...?=", () => {
  const out = encodeMimeHeader("Екатерина Горбова");
  assertStringIncludes(out, "=?UTF-8?B?");
  assertStringIncludes(out, "?=");
  // Must decode back to original
  const b64 = out.replace(/^=\?UTF-8\?B\?/, "").replace(/\?=$/, "");
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  assertEquals(new TextDecoder().decode(bytes), "Екатерина Горбова");
});

Deno.test("encodeAddressHeader: ASCII display-name is quoted", () => {
  assertEquals(
    encodeAddressHeader("Gorbova", "noreply@gorbova.by"),
    '"Gorbova" <noreply@gorbova.by>',
  );
});

Deno.test("encodeAddressHeader: Unicode display-name is MIME-encoded", () => {
  const out = encodeAddressHeader("Екатерина Горбова", "noreply@gorbova.by");
  assertStringIncludes(out, "=?UTF-8?B?");
  assertStringIncludes(out, "<noreply@gorbova.by>");
});

Deno.test("encodeAddressHeader: empty display-name → bare <email>", () => {
  assertEquals(encodeAddressHeader("", "x@y.z"), "<x@y.z>");
});

Deno.test("encodeAddressHeader: quote-escaping in ASCII names", () => {
  assertEquals(
    encodeAddressHeader('He said "hi"', "a@b.c"),
    '"He said \\"hi\\"" <a@b.c>',
  );
});
