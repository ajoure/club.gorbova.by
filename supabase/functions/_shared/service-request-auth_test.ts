import { assertEquals } from "jsr:@std/assert@1";
import { requestHasServiceRoleKey } from "./service-request-auth.ts";

const serviceKey = "sb_secret_test_only";

Deno.test("accepts the exact service key in apikey", () => {
  const request = new Request("https://example.test", {
    headers: { apikey: serviceKey },
  });
  assertEquals(requestHasServiceRoleKey(request, serviceKey), true);
});

Deno.test("accepts the exact legacy service key as bearer", () => {
  const request = new Request("https://example.test", {
    headers: { Authorization: `Bearer ${serviceKey}` },
  });
  assertEquals(requestHasServiceRoleKey(request, serviceKey), true);
});

Deno.test("rejects missing, partial and unrelated keys", () => {
  assertEquals(
    requestHasServiceRoleKey(new Request("https://example.test"), serviceKey),
    false,
  );
  assertEquals(
    requestHasServiceRoleKey(
      new Request("https://example.test", {
        headers: { apikey: `${serviceKey}-other` },
      }),
      serviceKey,
    ),
    false,
  );
  assertEquals(
    requestHasServiceRoleKey(
      new Request("https://example.test", {
        headers: { Authorization: "Bearer user-jwt" },
      }),
      serviceKey,
    ),
    false,
  );
});
