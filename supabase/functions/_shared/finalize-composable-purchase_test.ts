import { assertEquals } from "jsr:@std/assert@1";
import {
  GrantAccessInvokeError,
  normalizeAccessOpening,
  readGrantInvokeFailure,
} from "./finalize-composable-purchase.ts";

Deno.test("missing add-on delivery configuration fails closed", () => {
  assertEquals(normalizeAccessOpening({}), {
    mode: "manual",
    opensAt: null,
    durationDays: null,
  });
});

Deno.test("fixed-date access preserves its configured opening instant", () => {
  assertEquals(normalizeAccessOpening({
    access_delivery_mode: "fixed_date",
    access_opens_at: "2026-09-30T21:00:00.000Z",
    access_duration_days: 30,
  }), {
    mode: "fixed_date",
    opensAt: "2026-09-30T21:00:00.000Z",
    durationDays: 30,
  });
});

Deno.test("fixed-date access without a date fails closed", () => {
  assertEquals(normalizeAccessOpening({ access_delivery_mode: "fixed_date" }), {
    mode: "manual",
    opensAt: null,
    durationDays: null,
  });
});

Deno.test("grant invocation keeps gateway status and a safe response code", async () => {
  const error = {
    name: "FunctionsHttpError",
    context: new Response(
      JSON.stringify({ error: "unauthorized_invalid_token" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    ),
  };

  assertEquals(await readGrantInvokeFailure(null, error), {
    status: 401,
    code: "unauthorized_invalid_token",
  });
});

Deno.test("grant invocation never copies an unsafe response message", async () => {
  const error = {
    name: "FunctionsHttpError",
    context: new Response(
      JSON.stringify({ error: "invalid value containing customer data" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    ),
  };

  assertEquals(await readGrantInvokeFailure(null, error), {
    status: 500,
    code: "FunctionsHttpError",
  });
});

Deno.test("structured grant error exposes only status and code", () => {
  const error = new GrantAccessInvokeError(401, "unauthorized_invalid_token");
  assertEquals(error.status, 401);
  assertEquals(error.code, "unauthorized_invalid_token");
  assertEquals(
    error.message,
    "grant_access_invoke_failed:status=401:code=unauthorized_invalid_token",
  );
});
