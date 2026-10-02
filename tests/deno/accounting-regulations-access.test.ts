import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveSectionAccess } from "../../supabase/functions/_shared/ai-access.ts";
import { withRegulationsAccess } from "../../supabase/functions/ai-access-status/accounting-regulations.ts";

function client(allowed: boolean, options: { inactive?: boolean; missing?: boolean; rpcError?: boolean; admin?: boolean } = {}) {
  return {
    from(table: string) {
      const data = table === 'user_roles' ? (options.admin ? [{ role: 'admin' }] : [])
        : table === 'app_sections' ? (options.missing ? null : { id: 'section', is_active: !options.inactive }) : [{ id: 'rule' }];
      const chain: any = {
        select() { return chain; }, eq() { return chain; }, in() { return chain; },
        limit() { return Promise.resolve({ data, error: null }); },
        maybeSingle() { return Promise.resolve({ data, error: null }); },
        then(resolve: any) { resolve({ data, error: null }); },
      };
      return chain;
    },
    rpc() { return Promise.resolve({ data: allowed, error: options.rpcError ? new Error('unavailable') : null }); },
  };
}
for (const [name, allowed, options, expected] of [
  ['active purchaser via editable rule', true, {}, true],
  ['no purchase', false, {}, false],
  ['expired purchase RPC false', false, {}, false],
  ['inactive section', true, { inactive: true }, false],
  ['missing section', true, { missing: true }, false],
  ['RPC failure fails closed', true, { rpcError: true }, false],
  ['existing admin bypass', false, { admin: true }, true],
] as const) {
  Deno.test(`accounting regulations: ${name}`, async () => {
    assertEquals(await resolveSectionAccess(client(allowed, options), 'operator', 'ai_accounting_regulations'), expected);
    const status: any = { allowed_scenarios: [{ code: 'accounting_regulations', allowed: true }, { code: '107NK', allowed: false }], allowed_modes: { chat: false, prompt: false }, denial_reasons: {} };
    const projected = await withRegulationsAccess(client(allowed, options), 'operator', status);
    assertEquals(projected.allowed_scenarios[0].allowed, expected);
    assertEquals(projected.allowed_modes.prompt, expected);
    assertEquals(projected.allowed_modes.chat, false);
  });
}
