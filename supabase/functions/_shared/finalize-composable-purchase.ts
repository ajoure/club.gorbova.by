export interface FinalizeComposablePurchaseInput {
  primaryOrderId: string;
  paymentId?: string | null;
  source: string;
}

export interface FinalizedPurchaseItem {
  order_id: string;
  role: "primary" | "addon";
  state: "granted" | "scheduled" | "already_scheduled";
  scheduled_access_id?: string;
  opens_at?: string | null;
}

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

type AccessOpening = {
  mode: "immediate" | "fixed_date" | "manual";
  opensAt: string | null;
  durationDays: number | null;
};

export function normalizeAccessOpening(value: Record<string, unknown>): AccessOpening {
  const rawMode = typeof value.access_delivery_mode === "string"
    ? value.access_delivery_mode
    : null;
  const opensAt = typeof value.access_opens_at === "string"
    ? value.access_opens_at
    : null;
  const duration = value.access_duration_days == null
    ? null
    : Number(value.access_duration_days);
  const durationDays = Number.isFinite(duration) ? duration : null;

  if (rawMode === "immediate") return { mode: rawMode, opensAt: null, durationDays };
  if (rawMode === "fixed_date" && opensAt && Number.isFinite(Date.parse(opensAt))) {
    return { mode: rawMode, opensAt, durationDays };
  }
  if (rawMode === "manual") return { mode: rawMode, opensAt, durationDays };

  // Missing or inconsistent configuration must never unlock paid content.
  return { mode: "manual", opensAt: null, durationDays };
}

async function resolveAddonAccessOpening(
  admin: any,
  item: any,
  snapshot: Record<string, unknown>,
  primaryOfferId: string | null,
): Promise<AccessOpening> {
  if (typeof snapshot.access_delivery_mode === "string") {
    return normalizeAccessOpening(snapshot);
  }
  if (!primaryOfferId) return normalizeAccessOpening({});

  const { data, error } = await admin
    .from("offer_addons")
    .select("access_delivery_mode,access_opens_at,access_duration_days")
    .eq("parent_offer_id", primaryOfferId)
    .eq("addon_offer_id", item.offer_id)
    .eq("addon_product_id", item.product_id)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error(`addon_access_configuration_lookup_failed:${error.message}`);
  return normalizeAccessOpening(asObject(data));
}

const grantFailed = (data: unknown, error: unknown) => {
  const payload = asObject(data);
  return !!error || payload.success === false || !!payload.error ||
    payload.warning === "no_user_id";
};

export class GrantAccessInvokeError extends Error {
  readonly status: number | null;
  readonly code: string;

  constructor(status: number | null, code: string) {
    super(
      `grant_access_invoke_failed:status=${status ?? "unknown"}:code=${code}`,
    );
    this.name = "GrantAccessInvokeError";
    this.status = status;
    this.code = code;
  }
}

const safeGrantCode = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().slice(0, 160);
  return /^[a-zA-Z0-9_.:-]+$/.test(normalized) ? normalized : null;
};

export async function readGrantInvokeFailure(
  data: unknown,
  error: unknown,
): Promise<{ status: number | null; code: string }> {
  const invokeError = asObject(error);
  const response = invokeError.context instanceof Response
    ? invokeError.context
    : null;
  let payload = asObject(data);
  if (response) {
    try {
      payload = asObject(await response.clone().json());
    } catch {
      payload = asObject(data);
    }
  }
  const code = safeGrantCode(payload.error) ??
    safeGrantCode(payload.warning) ??
    safeGrantCode(payload.reason) ??
    safeGrantCode(payload.code) ??
    safeGrantCode(invokeError.name) ??
    "unknown";
  return { status: response?.status ?? null, code };
}

interface FunctionInvoker {
  functions: {
    invoke(
      name: string,
      options: { body: Record<string, unknown> },
    ): Promise<{ data: unknown; error: unknown }>;
  };
}

async function grantAccessForOrder(
  admin: FunctionInvoker,
  orderId: string,
): Promise<void> {
  const { data, error } = await admin.functions.invoke(
    "grant-access-for-order",
    { body: { orderId } },
  );
  if (grantFailed(data, error)) {
    const failure = await readGrantInvokeFailure(data, error);
    throw new GrantAccessInvokeError(failure.status, failure.code);
  }
}

/**
 * One fulfilment boundary for composable purchases.
 *
 * A grouped payment creates one CRM deal but every order_group_item keeps its
 * own order and access lifecycle. Delayed add-ons are recorded as purchased
 * immediately without creating an active entitlement before their opening
 * condition is met.
 */
export async function finalizeComposablePurchase(
  admin: any,
  input: FinalizeComposablePurchaseInput,
): Promise<{
  ok: true;
  state: "not_grouped" | "awaiting_full_payment" | "fulfilled";
  order_group_id?: string;
  items: FinalizedPurchaseItem[];
}> {
  const { data: group, error: groupError } = await admin
    .from("order_groups")
    .select("id,status,user_id,profile_id,paid_at")
    .eq("primary_order_id", input.primaryOrderId)
    .maybeSingle();
  if (groupError) throw new Error(`order_group_lookup_failed:${groupError.message}`);

  if (!group) {
    await grantAccessForOrder(admin, input.primaryOrderId);
    return {
      ok: true,
      state: "not_grouped",
      items: [{
        order_id: input.primaryOrderId,
        role: "primary",
        state: "granted",
      }],
    };
  }

  if (group.status !== "paid" && input.paymentId) {
    const { error: settleError } = await admin.rpc("settle_composable_order_group", {
      _primary_order_id: input.primaryOrderId,
      _payment_id: input.paymentId,
    });
    if (settleError) {
      if (
        String(settleError.message).includes("group_payment_amount_mismatch") ||
        String(settleError.message).includes("succeeded_primary_payment_required")
      ) {
        return {
          ok: true,
          state: "awaiting_full_payment",
          order_group_id: group.id,
          items: [],
        };
      }
      throw new Error(`order_group_settlement_failed:${settleError.message}`);
    }
  }

  const { data: refreshedGroup, error: refreshedGroupError } = await admin
    .from("order_groups")
    .select("id,status,user_id,profile_id,paid_at")
    .eq("id", group.id)
    .single();
  if (refreshedGroupError) {
    throw new Error(`order_group_refresh_failed:${refreshedGroupError.message}`);
  }
  if (refreshedGroup.status !== "paid") {
    return {
      ok: true,
      state: "awaiting_full_payment",
      order_group_id: group.id,
      items: [],
    };
  }

  const { data: groupItems, error: itemsError } = await admin
    .from("order_group_items")
    .select(
      "id,order_id,role,product_id,tariff_id,offer_id,item_snapshot,sort_order",
    )
    .eq("order_group_id", group.id)
    .order("sort_order");
  if (itemsError) throw new Error(`order_group_items_lookup_failed:${itemsError.message}`);

  const results: FinalizedPurchaseItem[] = [];
  const primaryOfferId = (groupItems ?? []).find((item: any) => item.role === "primary")
    ?.offer_id ?? null;
  for (const item of groupItems ?? []) {
    if (!item.order_id) throw new Error(`order_group_item_order_missing:${item.id}`);
    const snapshot = asObject(item.item_snapshot);
    const opening = item.role === "primary"
      ? normalizeAccessOpening({ access_delivery_mode: "immediate" })
      : await resolveAddonAccessOpening(admin, item, snapshot, primaryOfferId);
    const configuredMode = opening.mode;
    const opensAt = opening.opensAt;
    const fixedDateAlreadyReached = configuredMode === "fixed_date" &&
      !!opensAt && Date.parse(opensAt) <= Date.now();
    const shouldGrantNow = item.role === "primary" ||
      configuredMode === "immediate" ||
      fixedDateAlreadyReached;

    if (shouldGrantNow) {
      await grantAccessForOrder(admin, item.order_id);
      results.push({
        order_id: item.order_id,
        role: item.role,
        state: "granted",
      });
      continue;
    }

    if (configuredMode !== "fixed_date" && configuredMode !== "manual") {
      throw new Error(`unsupported_access_delivery_mode:${configuredMode}`);
    }
    const durationDays = opening.durationDays;
    const payload = {
      order_group_id: group.id,
      order_group_item_id: item.id,
      order_id: item.order_id,
      profile_id: refreshedGroup.profile_id,
      user_id: refreshedGroup.user_id,
      product_id: item.product_id,
      tariff_id: item.tariff_id,
      offer_id: item.offer_id,
      access_delivery_mode: configuredMode,
      opens_at: opensAt,
      access_duration_days: durationDays,
      status: "scheduled",
      purchase_confirmed_at: refreshedGroup.paid_at ?? new Date().toISOString(),
      access_snapshot: snapshot,
      meta: {
        source: input.source,
        primary_order_id: input.primaryOrderId,
      },
    };
    const { data: scheduled, error: scheduledError } = await admin
      .from("scheduled_product_access")
      .upsert(payload, { onConflict: "order_group_item_id", ignoreDuplicates: true })
      .select("id,opens_at")
      .maybeSingle();
    if (scheduledError) {
      throw new Error(`scheduled_access_create_failed:${scheduledError.message}`);
    }
    if (scheduled) {
      results.push({
        order_id: item.order_id,
        role: item.role,
        state: "scheduled",
        scheduled_access_id: scheduled.id,
        opens_at: scheduled.opens_at,
      });
    } else {
      const { data: existing, error: existingError } = await admin
        .from("scheduled_product_access")
        .select("id,opens_at")
        .eq("order_group_item_id", item.id)
        .single();
      if (existingError) {
        throw new Error(`scheduled_access_reload_failed:${existingError.message}`);
      }
      results.push({
        order_id: item.order_id,
        role: item.role,
        state: "already_scheduled",
        scheduled_access_id: existing.id,
        opens_at: existing.opens_at,
      });
    }
  }

  return {
    ok: true,
    state: "fulfilled",
    order_group_id: group.id,
    items: results,
  };
}
