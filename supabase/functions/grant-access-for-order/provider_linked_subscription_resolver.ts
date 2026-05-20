/**
 * PATCH SB1 (2026-05): Provider-linked pre-created subscription resolver.
 *
 * SOT: `provider_subscriptions` table is the canonical link between a bePaid
 * `sbs_*` id and a `subscriptions_v2` row. When `bepaid-create-subscription-checkout`
 * pre-creates a `subscriptions_v2` row (status=`past_due`, access_end_at=NULL)
 * AND inserts a matching `provider_subscriptions` row tagged with
 * `tracking_id = subv2:{subscription_v2_id}:order:{order_id}`, the eventual
 * paid order MUST extend THAT exact subv2 — not create a parallel one.
 *
 * The original extend resolver in `grant-access-for-order` only matched on
 * `(user_id, product_id, tariff_id, status='active')`. Pre-created `past_due`
 * rows were invisible to it, so it would create a NEW active subv2 while the
 * bePaid sbs kept charging the past_due row (split-brain — see Belko
 * 2026-05-20 incident, plan `.lovable/plan.md`).
 *
 * This helper:
 *   1. Finds `provider_subscriptions` rows linked to this order (by `order_id`
 *      column OR strict `tracking_id` parse) with state IN ('active','pending').
 *   2. Strictly parses `tracking_id` (no LIKE heuristic) and demands
 *      `parsed_subv2_id == ps.subscription_v2_id` and `parsed_order_id == orderId`.
 *   3. Loads referenced `subscriptions_v2` and validates user/product/tariff.
 *   4. Returns one of three outcomes — caller decides what to do.
 *
 * Outcomes:
 *   - `no_provider_linked`     → fall through to legacy active-sub lookup.
 *   - `extend`                 → use returned sub as `existingProductSub`.
 *   - `manual_review_provider_linkage_conflict`
 *                              → STOP, audit, HTTP 200 skipped, NO new subv2.
 */

export type ProviderLinkedResolverOutcome =
  | {
      outcome: 'no_provider_linked';
    }
  | {
      outcome: 'extend';
      subscription: {
        id: string;
        user_id: string;
        product_id: string | null;
        tariff_id: string | null;
        status: string;
        access_end_at: string | null;
        auto_renew: boolean;
      };
      provider_subscription: {
        id: string;
        subscription_v2_id: string;
        provider_subscription_id: string | null;
        state: string;
        tracking_id: string | null;
        order_id: string | null;
      };
      reason: 'order_id_match' | 'tracking_id_strict_match';
    }
  | {
      outcome: 'manual_review_provider_linkage_conflict';
      reason:
        | 'tracking_id_parse_failed'
        | 'tracking_id_subv2_mismatch'
        | 'tracking_id_order_mismatch'
        | 'subv2_not_found'
        | 'user_mismatch'
        | 'product_mismatch'
        | 'tariff_mismatch'
        | 'subv2_terminal_status';
      details: Record<string, unknown>;
    };

export interface ResolverInput {
  orderId: string;
  userId: string;
  productId: string | null;
  tariffId: string | null;
}

// Permissive Supabase client type (matches the index.ts call sites).
export interface SupabaseLike {
  from: (table: string) => any;
}

const TRACKING_RE = /^subv2:([0-9a-f-]{36}):order:([0-9a-f-]{36})$/i;

/** Strict tracking_id parser. Returns null on any format violation. */
export function parseTrackingId(
  raw: string | null | undefined,
): { subscription_v2_id: string; order_id: string } | null {
  if (!raw || typeof raw !== 'string') return null;
  const m = raw.trim().match(TRACKING_RE);
  if (!m) return null;
  return { subscription_v2_id: m[1].toLowerCase(), order_id: m[2].toLowerCase() };
}

const TERMINAL_STATUSES = new Set([
  'canceled',
  'expired',
  'superseded',
  'expired_reentry',
]);

/**
 * Run the provider-linked subscription lookup for an order.
 * `provider_subscriptions` rows are filtered to bePaid provider only and
 * state IN ('active','pending').
 */
export async function resolveProviderLinkedSubscription(
  supabase: SupabaseLike,
  input: ResolverInput,
): Promise<ProviderLinkedResolverOutcome> {
  const { orderId, userId, productId, tariffId } = input;

  // 1. Candidate provider_subscriptions: same order_id OR tracking_id mentions this order.
  //    We collect BOTH and dedupe by row id.
  const { data: byOrderId } = await supabase
    .from('provider_subscriptions')
    .select('id, subscription_v2_id, provider_subscription_id, state, order_id, meta')
    .eq('order_id', orderId)
    .eq('provider', 'bepaid')
    .in('state', ['active', 'pending'])
    .order('updated_at', { ascending: false })
    .limit(10);

  // tracking_id lives in meta JSONB; PostgREST supports ->> with .eq on the exact value.
  // The strict suffix `:order:{orderId}` lets us narrow without LIKE.
  // We accept any subv2 uuid in front via .like — the strict parser below rejects
  // anything that isn't a real UUID, so the like is only a lightweight pre-filter.
  const trackingSuffix = `:order:${orderId}`;
  const { data: byTracking } = await supabase
    .from('provider_subscriptions')
    .select('id, subscription_v2_id, provider_subscription_id, state, order_id, meta')
    .eq('provider', 'bepaid')
    .in('state', ['active', 'pending'])
    .like('meta->>tracking_id', `%${trackingSuffix}`)
    .order('updated_at', { ascending: false })
    .limit(10);

  const seen = new Set<string>();
  const candidates: any[] = [];
  for (const row of [...(byOrderId || []), ...(byTracking || [])]) {
    if (row?.id && !seen.has(row.id)) {
      seen.add(row.id);
      candidates.push(row);
    }
  }

  if (candidates.length === 0) {
    return { outcome: 'no_provider_linked' };
  }

  // 2. For each candidate, strict-validate tracking_id (when present) and pick
  //    the first one whose link survives all checks.
  for (const ps of candidates) {
    const trackingId: string | null = (ps?.meta || {}).tracking_id ?? null;
    let matchReason: 'order_id_match' | 'tracking_id_strict_match' = 'order_id_match';

    if (trackingId) {
      const parsed = parseTrackingId(trackingId);
      if (!parsed) {
        return {
          outcome: 'manual_review_provider_linkage_conflict',
          reason: 'tracking_id_parse_failed',
          details: {
            provider_subscription_row_id: ps.id,
            tracking_id: trackingId,
            order_id: orderId,
          },
        };
      }
      if (parsed.subscription_v2_id !== String(ps.subscription_v2_id || '').toLowerCase()) {
        return {
          outcome: 'manual_review_provider_linkage_conflict',
          reason: 'tracking_id_subv2_mismatch',
          details: {
            provider_subscription_row_id: ps.id,
            tracking_id: trackingId,
            parsed_subv2_id: parsed.subscription_v2_id,
            ps_subv2_id: ps.subscription_v2_id,
          },
        };
      }
      if (parsed.order_id !== orderId.toLowerCase()) {
        return {
          outcome: 'manual_review_provider_linkage_conflict',
          reason: 'tracking_id_order_mismatch',
          details: {
            provider_subscription_row_id: ps.id,
            tracking_id: trackingId,
            parsed_order_id: parsed.order_id,
            current_order_id: orderId,
          },
        };
      }
      matchReason = 'tracking_id_strict_match';
    } else if (String(ps.order_id || '').toLowerCase() !== orderId.toLowerCase()) {
      // No tracking_id AND order_id column doesn't match → skip this candidate.
      continue;
    }

    // 3. Load the referenced subv2.
    const { data: sub } = await supabase
      .from('subscriptions_v2')
      .select('id, user_id, product_id, tariff_id, status, access_end_at, auto_renew')
      .eq('id', ps.subscription_v2_id)
      .maybeSingle();

    if (!sub) {
      return {
        outcome: 'manual_review_provider_linkage_conflict',
        reason: 'subv2_not_found',
        details: {
          provider_subscription_row_id: ps.id,
          subv2_id: ps.subscription_v2_id,
          tracking_id: trackingId,
        },
      };
    }
    if (String(sub.user_id) !== String(userId)) {
      return {
        outcome: 'manual_review_provider_linkage_conflict',
        reason: 'user_mismatch',
        details: {
          provider_subscription_row_id: ps.id,
          subv2_id: sub.id,
          subv2_user_id: sub.user_id,
          order_user_id: userId,
        },
      };
    }
    if (productId && sub.product_id && String(sub.product_id) !== String(productId)) {
      return {
        outcome: 'manual_review_provider_linkage_conflict',
        reason: 'product_mismatch',
        details: {
          provider_subscription_row_id: ps.id,
          subv2_id: sub.id,
          subv2_product_id: sub.product_id,
          order_product_id: productId,
        },
      };
    }
    if (tariffId && sub.tariff_id && String(sub.tariff_id) !== String(tariffId)) {
      return {
        outcome: 'manual_review_provider_linkage_conflict',
        reason: 'tariff_mismatch',
        details: {
          provider_subscription_row_id: ps.id,
          subv2_id: sub.id,
          subv2_tariff_id: sub.tariff_id,
          order_tariff_id: tariffId,
        },
      };
    }
    if (TERMINAL_STATUSES.has(String(sub.status))) {
      return {
        outcome: 'manual_review_provider_linkage_conflict',
        reason: 'subv2_terminal_status',
        details: {
          provider_subscription_row_id: ps.id,
          subv2_id: sub.id,
          subv2_status: sub.status,
        },
      };
    }

    return {
      outcome: 'extend',
      subscription: {
        id: sub.id,
        user_id: sub.user_id,
        product_id: sub.product_id,
        tariff_id: sub.tariff_id,
        status: sub.status,
        access_end_at: sub.access_end_at,
        auto_renew: !!sub.auto_renew,
      },
      provider_subscription: {
        id: ps.id,
        subscription_v2_id: ps.subscription_v2_id,
        provider_subscription_id: ps.provider_subscription_id ?? null,
        state: ps.state,
        tracking_id: trackingId,
        order_id: ps.order_id ?? null,
      },
      reason: matchReason,
    };
  }

  return { outcome: 'no_provider_linked' };
}
