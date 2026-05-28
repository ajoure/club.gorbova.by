// ============================================================================
// package-tokens-dry-run — Sprint 3C, isolated debug endpoint.
// ----------------------------------------------------------------------------
// СТАТУС: dev/debug-only. Super_admin gated.
//   • Принимает (package_session_id, alias_tokens[]) и возвращает «что вернул
//     бы resolver», вызывая resolvePackageTokenCore (без feature-flag guard).
//   • НЕ пишет в snapshot, ai_generated_documents, storage, Gotenberg.
//   • НЕ затрагивает canonical-document-generate-strict.
//   • Пишет одну строку аудита `package_tokens_dry_run` без значений токенов
//     (только summary by code).
//   • Rate-limit: не чаще 1 запроса в 5 секунд от одного актёра, max 20
//     токенов за вызов.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { resolvePackageTokenCore } from '../_shared/resolve-package-tokens.ts';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Body {
  package_session_id?: unknown;
  alias_tokens?: unknown;
}

function bad(status: number, error: string, extra?: Record<string, unknown>) {
  return new Response(
    JSON.stringify({ error, ...(extra ?? {}) }),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return bad(405, 'method_not_allowed');

  // 1. JWT
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return bad(401, 'unauthorized');

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const token = authHeader.replace('Bearer ', '');
  const { data: claims, error: claimsErr } = await userClient.auth.getClaims(token);
  if (claimsErr || !claims?.claims?.sub) return bad(401, 'unauthorized');
  const actorId = claims.claims.sub as string;

  // 2. Super_admin check (RBAC SOT через has_role_v2)
  const service = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: isSuperAdmin, error: roleErr } = await service.rpc('has_role_v2', {
    _user_id: actorId,
    _role: 'super_admin',
  });
  if (roleErr || isSuperAdmin !== true) return bad(403, 'forbidden_not_super_admin');

  // 3. Rate-limit: <=1 запрос / 5s от того же актёра.
  const since = new Date(Date.now() - 5_000).toISOString();
  const { count: recentCount } = await service
    .from('audit_logs')
    .select('id', { head: true, count: 'exact' })
    .eq('action', 'package_tokens_dry_run')
    .eq('actor_user_id', actorId)
    .gte('created_at', since);
  if ((recentCount ?? 0) > 0) return bad(429, 'rate_limited_5s');

  // 4. Input
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return bad(400, 'invalid_json');
  }
  const sessionId = typeof body.package_session_id === 'string' ? body.package_session_id : '';
  const aliasTokens = Array.isArray(body.alias_tokens)
    ? body.alias_tokens.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean)
    : [];
  if (!UUID_RE.test(sessionId)) return bad(400, 'invalid_package_session_id');
  if (aliasTokens.length === 0) return bad(400, 'alias_tokens_required');
  if (aliasTokens.length > 20) return bad(400, 'too_many_tokens_max_20');

  // 5. Resolve каждый токен через CORE (минуя HARDCODED_ENABLED).
  const results = [];
  const codeCounts: Record<string, number> = {};
  for (const raw of aliasTokens) {
    const r = await resolvePackageTokenCore({
      rawToken: raw,
      packageSessionId: sessionId,
      supabase: service,
    });
    if (r.resolved) {
      codeCounts['resolved'] = (codeCounts['resolved'] ?? 0) + 1;
      results.push({
        alias_token: raw,
        resolved: true,
        value: r.value,
        alias_id: r.aliasId,
        canonical_field_public_id: r.canonicalFieldPublicId,
        role_key: r.roleKey,
        context_kind: r.contextKind,
      });
    } else {
      codeCounts[r.code] = (codeCounts[r.code] ?? 0) + 1;
      results.push({
        alias_token: raw,
        resolved: false,
        code: r.code,
        warning: r.warning,
        alias_id: r.aliasId,
        role_key: r.roleKey,
      });
    }
  }

  // 6. Audit (без значений)
  await service.from('audit_logs').insert({
    action: 'package_tokens_dry_run',
    actor_user_id: actorId,
    actor_type: 'user',
    actor_label: 'super_admin_dry_run',
    meta: {
      package_session_id: sessionId,
      alias_tokens_count: aliasTokens.length,
      alias_tokens: aliasTokens,
      codes: codeCounts,
    },
  });

  return new Response(
    JSON.stringify({
      ok: true,
      package_session_id: sessionId,
      results,
      summary: codeCounts,
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
