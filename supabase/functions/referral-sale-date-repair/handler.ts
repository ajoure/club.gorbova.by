import { requestHasServiceRoleKey } from "../_shared/service-request-auth.ts";

type RpcResult = { data: unknown; error: { message?: string } | null };
export type RepairDependencies = {
  serviceKey: string;
  rpc: (args: Record<string, unknown>) => PromiseLike<RpcResult>;
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

// A single fixed service-only RPC. Never a general SQL or function proxy.
export async function handleRepair(
  req: Request,
  deps: RepairDependencies,
): Promise<Response> {
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });
  if (!requestHasServiceRoleKey(req, deps.serviceKey)) {
    return reply(401, { error: "unauthorized" });
  }
  let body: Record<string, unknown>;
  try {
    const value = await req.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error();
    }
    body = value;
  } catch {
    return reply(400, { error: "invalid_json" });
  }
  const allowed = new Set([
    "p_operation_key",
    "p_items",
    "p_expected_balances",
    "p_dry_run",
  ]);
  if (
    Object.keys(body).some((key) => !allowed.has(key)) ||
    typeof body.p_operation_key !== "string" || !body.p_operation_key.trim() ||
    body.p_operation_key.length > 120 ||
    !Array.isArray(body.p_items) || body.p_items.length < 1 ||
    body.p_items.length > 50 ||
    !body.p_expected_balances || typeof body.p_expected_balances !== "object" ||
    Array.isArray(body.p_expected_balances) ||
    (body.p_dry_run !== undefined && typeof body.p_dry_run !== "boolean")
  ) {
    return reply(400, { error: "invalid_repair_request" });
  }
  const args = { ...body, p_dry_run: body.p_dry_run ?? true };
  try {
    const { data, error } = await deps.rpc(args);
    if (error) {
      // Expose only a symbolic database guard, never SQL details or client data.
      const guard = error.message?.match(/^[a-z][a-z0-9_]{0,100}$/)?.[0];
      return reply(guard === "forbidden" ? 403 : 409, {
        error: guard ?? "repair_rpc_failed",
        operation_key: body.p_operation_key,
      });
    }
    if (!data || typeof data !== "object") {
      return reply(502, {
        error: "repair_result_unconfirmed",
        operation_key: body.p_operation_key,
      });
    }
    return reply(200, { operation_key: body.p_operation_key, result: data });
  } catch {
    // The transaction may have committed. Inspect this operation before any retry.
    return reply(503, {
      error: "rpc_transport_unknown",
      operation_key: body.p_operation_key,
    });
  }
}
