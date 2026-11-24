import { assertEquals } from "jsr:@std/assert@1";
import { handleRepair } from "./handler.ts";
const key = "sb_secret_unit_only";
const body = {
  p_operation_key: "repair-test",
  p_items: [{}],
  p_expected_balances: {},
};
const request = (
  payload: unknown = body,
  authenticated = true,
  method = "POST",
) =>
  new Request("https://example.test", {
    method,
    headers: authenticated ? { apikey: key } : {},
    ...(method === "POST" ? { body: JSON.stringify(payload) } : {}),
  });
Deno.test("unauthenticated and non-POST requests never reach RPC", async () => {
  let calls = 0;
  const deps = {
    serviceKey: key,
    rpc: () => {
      calls++;
      return Promise.resolve({ data: {}, error: null });
    },
  };
  assertEquals((await handleRepair(request(body, false), deps)).status, 401);
  assertEquals(
    (await handleRepair(request(body, true, "GET"), deps)).status,
    405,
  );
  assertEquals(
    (await handleRepair(request(), { ...deps, serviceKey: "" })).status,
    401,
  );
  assertEquals(calls, 0);
});
Deno.test("defaults to dry-run, explicit execute forwards frozen arguments once", async () => {
  const seen: Record<string, unknown>[] = [];
  const deps = {
    serviceKey: key,
    rpc: (args: Record<string, unknown>) => {
      seen.push(args);
      return Promise.resolve({ data: { status: "dry_run" }, error: null });
    },
  };
  assertEquals((await handleRepair(request(), deps)).status, 200);
  assertEquals(seen[0], { ...body, p_dry_run: true });
  await handleRepair(request({ ...body, p_dry_run: false }), deps);
  assertEquals(seen[1], { ...body, p_dry_run: false });
  assertEquals(seen.length, 2);
});
Deno.test("rejects ambiguous flags, generic proxy keys and malformed requests before RPC", async () => {
  let calls = 0;
  const deps = {
    serviceKey: key,
    rpc: () => {
      calls++;
      return Promise.resolve({ data: {}, error: null });
    },
  };
  for (
    const payload of [
      null,
      [],
      { ...body, p_dry_run: "false" },
      { ...body, sql: "select 1" },
      { ...body, p_items: [] },
      { ...body, p_expected_balances: [] },
      { ...body, p_operation_key: "" },
    ]
  ) {
    assertEquals((await handleRepair(request(payload), deps)).status, 400);
  }
  assertEquals(calls, 0);
});
Deno.test("database guards and replay result are passed without retry or private error detail", async () => {
  const guard = await handleRepair(request(), {
    serviceKey: key,
    rpc: () =>
      Promise.resolve({ data: null, error: { message: "balance_changed" } }),
  });
  assertEquals(guard.status, 409);
  assertEquals((await guard.json()).error, "balance_changed");
  const privateError = await handleRepair(request(), {
    serviceKey: key,
    rpc: () =>
      Promise.resolve({
        data: null,
        error: { message: "SQL contains sensitive detail" },
      }),
  });
  assertEquals((await privateError.json()).error, "repair_rpc_failed");
  const replay = await handleRepair(request(), {
    serviceKey: key,
    rpc: () =>
      Promise.resolve({ data: { status: "already_applied" }, error: null }),
  });
  assertEquals((await replay.json()).result.status, "already_applied");
});
Deno.test("unknown transport outcome is reported once without retry", async () => {
  let calls = 0;
  const response = await handleRepair(request(), {
    serviceKey: key,
    rpc: () => {
      calls++;
      throw new Error("private transport detail");
    },
  });
  assertEquals(response.status, 503);
  assertEquals((await response.json()).error, "rpc_transport_unknown");
  assertEquals(calls, 1);
});

Deno.test("verified administrator may invoke, role denial or lookup failure cannot reach RPC", async () => {
  let calls = 0;
  const deps = {
    serviceKey: key,
    rpc: () => {
      calls++;
      return Promise.resolve({ data: { dry_run: true }, error: null });
    },
  };
  assertEquals(
    (await handleRepair(request(body, false), {
      ...deps,
      authorizeAdmin: async () => true,
    })).status,
    200,
  );
  for (
    const authorizeAdmin of [async () => false, async () => {
      throw new Error("lookup failed");
    }]
  ) {
    assertEquals(
      (await handleRepair(request(body, false), { ...deps, authorizeAdmin }))
        .status,
      401,
    );
  }
  assertEquals(calls, 1);
});
