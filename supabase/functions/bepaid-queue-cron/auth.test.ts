import { assertEquals } from "jsr:@std/assert";
import { authorizeQueueCronRequest } from "./auth.ts";

const secrets = {
  serviceRoleKey: "service-role-test-key",
  cronSecret: "cron-test-key",
};

Deno.test("queue cron accepts the exact service role key", () => {
  const req = new Request("https://example.test", {
    headers: { apikey: secrets.serviceRoleKey },
  });
  assertEquals(authorizeQueueCronRequest(req, secrets), {
    ok: true,
    mode: "service_role",
  });
});

Deno.test("queue cron accepts the exact cron secret", () => {
  const req = new Request("https://example.test", {
    headers: { "x-cron-secret": secrets.cronSecret },
  });
  assertEquals(authorizeQueueCronRequest(req, secrets), {
    ok: true,
    mode: "cron_secret",
  });
});

Deno.test("queue cron rejects user JWTs and wrong secrets", () => {
  const req = new Request("https://example.test", {
    headers: {
      authorization: "Bearer ordinary-user-jwt",
      "x-cron-secret": "wrong",
    },
  });
  assertEquals(authorizeQueueCronRequest(req, secrets), {
    ok: false,
    status: 401,
    error: "unauthorized",
  });
});
