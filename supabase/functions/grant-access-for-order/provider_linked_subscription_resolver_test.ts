import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parseTrackingId,
  resolveProviderLinkedSubscription,
} from "./provider_linked_subscription_resolver.ts";

const ORDER = '59c6eb7d-efe2-46bb-a7a3-78c78140a07b';
const USER = '0012a7a4-1420-486c-b95e-e6ba5907ef93';
const PRODUCT = '11c9f1b8-0355-4753-bd74-40b42aa53616';
const TARIFF = '7c748940-dcad-4c7c-a92e-76a2344622d3';
const SUB_PRE = '46194979-fb2a-4106-af33-8d3a5fec847d';

// ── Mock supabase chain ─────────────────────────────────────────────────────
function mock(rows: {
  provider_subscriptions?: any[];
  subscriptions_v2?: any[];
}) {
  return {
    from(table: string) {
      const data: any[] = (rows as any)[table] || [];
      const builder: any = {
        _filtered: [...data],
        _maybeSingle: false,
        select() { return this; },
        eq(col: string, val: any) {
          this._filtered = this._filtered.filter((r: any) => {
            if (col.includes('->>')) {
              const [base, key] = col.split('->>');
              return String(((r[base] || {})[key] ?? '')) === String(val);
            }
            return String(r[col] ?? '') === String(val);
          });
          return this;
        },
        in(col: string, vals: any[]) {
          this._filtered = this._filtered.filter((r: any) => vals.includes(r[col]));
          return this;
        },
        like(col: string, pattern: string) {
          const re = new RegExp('^' + pattern.replace(/%/g, '.*') + '$', 'i');
          this._filtered = this._filtered.filter((r: any) => {
            if (col.includes('->>')) {
              const [base, key] = col.split('->>');
              return re.test(String((r[base] || {})[key] ?? ''));
            }
            return re.test(String(r[col] ?? ''));
          });
          return this;
        },
        order() { return this; },
        limit() { return this; },
        async maybeSingle() { return { data: this._filtered[0] ?? null, error: null }; },
        then(onF: any) { return Promise.resolve({ data: this._filtered, error: null }).then(onF); },
      };
      return builder;
    },
  };
}

Deno.test('parseTrackingId — strict format', () => {
  const ok = parseTrackingId(`subv2:${SUB_PRE}:order:${ORDER}`);
  assertEquals(ok?.subscription_v2_id, SUB_PRE);
  assertEquals(ok?.order_id, ORDER);

  assertEquals(parseTrackingId(null), null);
  assertEquals(parseTrackingId(''), null);
  assertEquals(parseTrackingId('subv2:not-a-uuid:order:x'), null);
  assertEquals(parseTrackingId(`subv2:${SUB_PRE}:order:`), null);
  assertEquals(parseTrackingId(`junk:${SUB_PRE}:order:${ORDER}`), null);
});

Deno.test('extend — Belko fixture: pre-created past_due + active provider_subscriptions', async () => {
  const supabase = mock({
    provider_subscriptions: [{
      id: 'ps1',
      provider: 'bepaid',
      subscription_v2_id: SUB_PRE,
      provider_subscription_id: 'sbs_96311287',
      state: 'active',
      order_id: ORDER,
      meta: { tracking_id: `subv2:${SUB_PRE}:order:${ORDER}` },
    }],
    subscriptions_v2: [{
      id: SUB_PRE, user_id: USER, product_id: PRODUCT, tariff_id: TARIFF,
      status: 'past_due', access_end_at: null, auto_renew: true,
    }],
  });
  const r = await resolveProviderLinkedSubscription(supabase as any, {
    orderId: ORDER, userId: USER, productId: PRODUCT, tariffId: TARIFF,
  });
  assertEquals(r.outcome, 'extend');
  if (r.outcome === 'extend') {
    assertEquals(r.subscription.id, SUB_PRE);
    assertEquals(r.reason, 'tracking_id_strict_match');
  }
});

Deno.test('no_provider_linked — empty provider_subscriptions', async () => {
  const supabase = mock({ provider_subscriptions: [], subscriptions_v2: [] });
  const r = await resolveProviderLinkedSubscription(supabase as any, {
    orderId: ORDER, userId: USER, productId: PRODUCT, tariffId: TARIFF,
  });
  assertEquals(r.outcome, 'no_provider_linked');
});

Deno.test('manual_review — tariff_mismatch', async () => {
  const FOREIGN_TARIFF = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const supabase = mock({
    provider_subscriptions: [{
      id: 'ps1', provider: 'bepaid', subscription_v2_id: SUB_PRE,
      provider_subscription_id: 'sbs_x', state: 'active', order_id: ORDER,
      meta: { tracking_id: `subv2:${SUB_PRE}:order:${ORDER}` },
    }],
    subscriptions_v2: [{
      id: SUB_PRE, user_id: USER, product_id: PRODUCT, tariff_id: FOREIGN_TARIFF,
      status: 'past_due', access_end_at: null, auto_renew: true,
    }],
  });
  const r = await resolveProviderLinkedSubscription(supabase as any, {
    orderId: ORDER, userId: USER, productId: PRODUCT, tariffId: TARIFF,
  });
  assertEquals(r.outcome, 'manual_review_provider_linkage_conflict');
  if (r.outcome === 'manual_review_provider_linkage_conflict') {
    assertEquals(r.reason, 'tariff_mismatch');
  }
});

Deno.test('manual_review — tracking_id parse failed', async () => {
  const supabase = mock({
    provider_subscriptions: [{
      id: 'ps1', provider: 'bepaid', subscription_v2_id: SUB_PRE,
      provider_subscription_id: 'sbs_x', state: 'active', order_id: ORDER,
      meta: { tracking_id: 'garbage-format' },
    }],
    subscriptions_v2: [{
      id: SUB_PRE, user_id: USER, product_id: PRODUCT, tariff_id: TARIFF,
      status: 'past_due', access_end_at: null, auto_renew: true,
    }],
  });
  const r = await resolveProviderLinkedSubscription(supabase as any, {
    orderId: ORDER, userId: USER, productId: PRODUCT, tariffId: TARIFF,
  });
  assertEquals(r.outcome, 'manual_review_provider_linkage_conflict');
  if (r.outcome === 'manual_review_provider_linkage_conflict') {
    assertEquals(r.reason, 'tracking_id_parse_failed');
  }
});

Deno.test('manual_review — subv2 terminal status (superseded)', async () => {
  const supabase = mock({
    provider_subscriptions: [{
      id: 'ps1', provider: 'bepaid', subscription_v2_id: SUB_PRE,
      provider_subscription_id: 'sbs_x', state: 'active', order_id: ORDER,
      meta: { tracking_id: `subv2:${SUB_PRE}:order:${ORDER}` },
    }],
    subscriptions_v2: [{
      id: SUB_PRE, user_id: USER, product_id: PRODUCT, tariff_id: TARIFF,
      status: 'superseded', access_end_at: null, auto_renew: false,
    }],
  });
  const r = await resolveProviderLinkedSubscription(supabase as any, {
    orderId: ORDER, userId: USER, productId: PRODUCT, tariffId: TARIFF,
  });
  assertEquals(r.outcome, 'manual_review_provider_linkage_conflict');
  if (r.outcome === 'manual_review_provider_linkage_conflict') {
    assertEquals(r.reason, 'subv2_terminal_status');
  }
});

Deno.test('no_provider_linked — provider_subscriptions in terminal state filtered out', async () => {
  const supabase = mock({
    provider_subscriptions: [{
      id: 'ps1', provider: 'bepaid', subscription_v2_id: SUB_PRE,
      provider_subscription_id: 'sbs_x', state: 'expired', order_id: ORDER,
      meta: { tracking_id: `subv2:${SUB_PRE}:order:${ORDER}` },
    }],
    subscriptions_v2: [{
      id: SUB_PRE, user_id: USER, product_id: PRODUCT, tariff_id: TARIFF,
      status: 'past_due', access_end_at: null, auto_renew: true,
    }],
  });
  const r = await resolveProviderLinkedSubscription(supabase as any, {
    orderId: ORDER, userId: USER, productId: PRODUCT, tariffId: TARIFF,
  });
  assertEquals(r.outcome, 'no_provider_linked');
});
