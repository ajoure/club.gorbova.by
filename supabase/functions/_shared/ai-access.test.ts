// Тесты admin-bypass / access-matrix / негативной гарантии для _shared/ai-access.ts
// Запуск: deno test --allow-env --allow-net supabase/functions/_shared/ai-access.test.ts
//
// Инварианты (не менять без обновления PATCH-AI-ACCESS-ADMIN-BYPASS отчёта):
//   1) admin/superadmin → tier='full', is_admin=true, все режимы allowed, entitlements НЕ читаются.
//   2) ЗАКРОЙ ГОД → только balance_analysis. chat/107NK/прочие сценарии заблокированы.
//   3) Просроченные entitlements игнорируются.
//   4) Обычный full-tier пользователь (Club/Business) НЕ получает is_admin=true.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  resolveAiAccess,
  isModeAllowed,
  PRODUCT_ZG,
  PRODUCT_GORBOVA_CLUB,
} from "./ai-access.ts";

// Мини-мок supabase-клиента: from(table).select().eq()....limit()/... возвращает { data, error }.
type MockRow = Record<string, any>;
function mockClient(opts: {
  userRoles?: MockRow[];
  entitlements?: MockRow[];
  userRolesError?: any;
  entitlementsError?: any;
}) {
  return {
    from(table: string) {
      const chain: any = {
        _table: table,
        _filters: {} as Record<string, any>,
        select() { return chain; },
        eq(col: string, val: any) { chain._filters[col] = val; return chain; },
        in(col: string, vals: any[]) { chain._filters[col + '__in'] = vals; return chain; },
        limit() { return chain._exec(); },
        then(resolve: any) { resolve(chain._exec()); },
        _exec() {
          if (table === 'user_roles') {
            if (opts.userRolesError) return { data: null, error: opts.userRolesError };
            const wanted = chain._filters['role__in'] as string[] | undefined;
            const rows = (opts.userRoles || []).filter(r =>
              (!wanted || wanted.includes(r.role)) &&
              (!chain._filters.user_id || r.user_id === chain._filters.user_id)
            );
            return { data: rows, error: null };
          }
          if (table === 'entitlements') {
            if (opts.entitlementsError) return { data: null, error: opts.entitlementsError };
            const wanted = chain._filters['product_id__in'] as string[] | undefined;
            const rows = (opts.entitlements || []).filter(r =>
              (!wanted || wanted.includes(r.product_id)) &&
              (!chain._filters.status || r.status === chain._filters.status) &&
              (!chain._filters.user_id || r.user_id === chain._filters.user_id)
            );
            return { data: rows, error: null };
          }
          return { data: [], error: null };
        },
      };
      return chain;
    },
  };
}

Deno.test("resolveAiAccess: no roles + no entitlements → tier='none'", async () => {
  const c = mockClient({});
  const a = await resolveAiAccess(c, "u1");
  assertEquals(a, { tier: 'none', chat: false, balance_analysis: false, '107NK': false, is_admin: false });
});

Deno.test("resolveAiAccess: только ЗГ → tier='zg_only', только balance_analysis", async () => {
  const c = mockClient({
    entitlements: [{ user_id: 'u1', product_id: PRODUCT_ZG, status: 'active', expires_at: null }],
  });
  const a = await resolveAiAccess(c, "u1");
  assertEquals(a.tier, 'zg_only');
  assertEquals(a.balance_analysis, true);
  assertEquals(a.chat, false);
  assertEquals(a['107NK'], false);
  assertEquals(a.is_admin, false);
});

Deno.test("resolveAiAccess: только Club → tier='full', is_admin=false", async () => {
  const c = mockClient({
    entitlements: [{ user_id: 'u1', product_id: PRODUCT_GORBOVA_CLUB, status: 'active', expires_at: null }],
  });
  const a = await resolveAiAccess(c, "u1");
  assertEquals(a.tier, 'full');
  assertEquals(a.is_admin, false); // full-tier ≠ admin — квоты остаются
  assertEquals(a.chat, true);
});

Deno.test("resolveAiAccess: admin без entitlements → tier='full', is_admin=true", async () => {
  const c = mockClient({ userRoles: [{ user_id: 'u1', role: 'admin' }] });
  const a = await resolveAiAccess(c, "u1");
  assertEquals(a, { tier: 'full', chat: true, balance_analysis: true, '107NK': true, is_admin: true });
});

Deno.test("resolveAiAccess: superadmin без entitlements → tier='full', is_admin=true", async () => {
  const c = mockClient({ userRoles: [{ user_id: 'u1', role: 'superadmin' }] });
  const a = await resolveAiAccess(c, "u1");
  assertEquals(a.tier, 'full');
  assertEquals(a.is_admin, true);
});

Deno.test("resolveAiAccess: admin + просроченные entitlements → всё равно 'full'", async () => {
  const c = mockClient({
    userRoles: [{ user_id: 'u1', role: 'admin' }],
    entitlements: [{ user_id: 'u1', product_id: PRODUCT_ZG, status: 'active', expires_at: '2020-01-01T00:00:00Z' }],
  });
  const a = await resolveAiAccess(c, "u1");
  assertEquals(a.tier, 'full');
  assertEquals(a.is_admin, true);
});

Deno.test("resolveAiAccess: просроченный ЗГ у обычного юзера → игнорируется", async () => {
  const c = mockClient({
    entitlements: [{ user_id: 'u1', product_id: PRODUCT_ZG, status: 'active', expires_at: '2020-01-01T00:00:00Z' }],
  });
  const a = await resolveAiAccess(c, "u1");
  assertEquals(a.tier, 'none');
});

Deno.test("isModeAllowed: ЗГ + prompt '107NK' → deny с reason='107NK_not_in_tier'", () => {
  const zg = { tier: 'zg_only' as const, chat: false, balance_analysis: true, '107NK': false, is_admin: false };
  const r = isModeAllowed(zg, 'prompt', '107NK');
  assertEquals(r, { allowed: false, reason: '107NK_not_in_tier' });
});

Deno.test("isModeAllowed: ЗГ + prompt 'other_branded' → deny scenario_requires_full_tier", () => {
  const zg = { tier: 'zg_only' as const, chat: false, balance_analysis: true, '107NK': false, is_admin: false };
  const r = isModeAllowed(zg, 'prompt', 'other_branded_scenario');
  assertEquals(r, { allowed: false, reason: 'scenario_requires_full_tier' });
});

Deno.test("isModeAllowed: admin + unknown future scenario → allow", () => {
  const admin = { tier: 'full' as const, chat: true, balance_analysis: true, '107NK': true, is_admin: true };
  assertEquals(isModeAllowed(admin, 'prompt', 'brand_new_2030_scenario'), { allowed: true });
  assertEquals(isModeAllowed(admin, 'chat'), { allowed: true });
});

Deno.test("isModeAllowed: none tier + chat → deny chat_not_in_tier", () => {
  const none = { tier: 'none' as const, chat: false, balance_analysis: false, '107NK': false, is_admin: false };
  assertEquals(isModeAllowed(none, 'chat'), { allowed: false, reason: 'chat_not_in_tier' });
});
