import type { ResolvedComposableCheckout } from "./resolve-composable-checkout.ts";

export async function materializeComposableOrderGroup(
  admin: any,
  input: {
    primaryOrderId: string;
    quote: ResolvedComposableCheckout | Record<string, unknown>;
    source: string;
    idempotencyKey: string;
  },
): Promise<string> {
  const { data, error } = await admin.rpc("materialize_composable_order_group", {
    _primary_order_id: input.primaryOrderId,
    _quote: input.quote,
    _source: input.source,
    _idempotency_key: input.idempotencyKey,
  });
  if (error || !data) {
    throw new Error(
      `composable_order_materialization_failed:${error?.message ?? "no_group_id"}`,
    );
  }
  return String(data);
}
