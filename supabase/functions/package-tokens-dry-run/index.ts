// ============================================================================
// package-tokens-dry-run — Sprint 3C + Stage E.3 (table-repeat structured branch)
// ----------------------------------------------------------------------------
// СТАТУС: dev/debug-only. Super_admin gated.
//   • Принимает (package_session_id, alias_tokens[]) и возвращает «что вернул
//     бы resolver», вызывая resolvePackageTokenCore (без feature-flag guard).
//   • Stage E.3: токены {{tableRepeat:TR-XXXXXX}} распознаются классификатором
//     и резолвятся через resolveTableRepeatTokenCore — возвращают structured
//     preview (rows_count, columns, rows_preview ≤5, cell.value ≤200 символов).
//   • НЕ пишет в snapshot, ai_generated_documents, storage, Gotenberg.
//   • НЕ затрагивает canonical-document-generate-strict.
//   • Пишет одну строку аудита `package_tokens_dry_run` БЕЗ значений токенов
//     (только summary by code + tr_id + rows_count для TR).
//   • Rate-limit: не чаще 1 запроса в 5 секунд от одного актёра, max 20
//     токенов за вызов.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import {
  resolvePackageTokenCore,
  resolveTableRepeatTokenCore,
} from '../_shared/resolve-package-tokens.ts';
import { classifyPlaceholder } from '../_shared/placeholderClassifier.ts';

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
  /**
   * Опционально. Обязателен для:
   *   • ln-XXXXXX / ln-XXXXXX.<sub_field> / ln-XXXXXX.custom.<key>
   *   • {{tableRepeat:TR-XXXXXX}}  (Stage E.3 — иначе tr_no_template_item).
   */
  package_template_item_id?: unknown;
}

function bad(status: number, error: string, extra?: Record<string, unknown>) {
  return new Response(
    JSON.stringify({ error, ...(extra ?? {}) }),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
}

/** Извлекает `inside` из обёртки {{...}} или возвращает исходную строку. */
function unwrapInside(raw: string): string {
  const m = raw.match(/^\{\{\s*([^{}]+?)\s*\}\}$/);
  return m ? m[1].trim() : raw.trim();
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

  // 2. Super_admin check (RBAC SOT через has_role_v2) — не ослаблено E.3.
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
  const packageTemplateItemId =
    typeof body.package_template_item_id === 'string' && UUID_RE.test(body.package_template_item_id)
      ? body.package_template_item_id
      : null;

  // 5. Resolve каждый токен.
  //    Stage E.3: классифицируем сначала; для package_table_repeat — отдельный
  //    structured-резолвер (не идёт через resolvePackageTokenCore).
  const results: unknown[] = [];
  const codeCounts: Record<string, number> = {};
  const trAuditSummaries: Array<{ tr_id: string; rows_count: number | null; codes: Record<string, number>; resolved: boolean; code?: string }> = [];

  for (const raw of aliasTokens) {
    const inside = unwrapInside(raw);
    const cls = classifyPlaceholder(inside);

    if (cls.kind === 'package_table_repeat') {
      const tr = await resolveTableRepeatTokenCore({
        trId: cls.public_id,
        packageSessionId: sessionId,
        packageTemplateItemId,
        supabase: service,
        isSuperAdmin: true,  // dry-run gated на super_admin (см. шаг 2).
      });
      if (tr.resolved) {
        codeCounts['resolved_table_repeat'] = (codeCounts['resolved_table_repeat'] ?? 0) + 1;
        results.push({
          alias_token: raw,
          kind: 'package_table_repeat',
          resolved: true,
          value: null,
          preview: {
            tr_id: tr.tr_id,
            role_catalog_id: tr.role_catalog_id,
            role_key: tr.role_key,
            rows_count: tr.rows_count,
            rows_preview_limit: tr.rows_preview_limit,
            rows_preview_truncated: tr.rows_preview_truncated,
            columns: tr.columns,
            rows_preview: tr.rows_preview,
          },
        });
        trAuditSummaries.push({
          tr_id: tr.tr_id,
          rows_count: tr.rows_count,
          codes: tr.cell_codes_summary,
          resolved: true,
        });
      } else {
        codeCounts[tr.code] = (codeCounts[tr.code] ?? 0) + 1;
        results.push({
          alias_token: raw,
          kind: 'package_table_repeat',
          resolved: false,
          code: tr.code,
          warning: tr.warning,
          issues: tr.issues,
        });
        trAuditSummaries.push({
          tr_id: tr.tr_id,
          rows_count: null,
          codes: {},
          resolved: false,
          code: tr.code,
        });
      }
      continue;
    }

    // Default: scalar token branch (field/pf/ln/ln.sub/ln.custom/package.*/alias).
    const r = await resolvePackageTokenCore({
      rawToken: inside,
      packageSessionId: sessionId,
      packageTemplateItemId,
      supabase: service,
    });
    if (r.resolved) {
      codeCounts['resolved'] = (codeCounts['resolved'] ?? 0) + 1;
      results.push({
        alias_token: raw,
        kind: 'scalar',
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
        kind: 'scalar',
        resolved: false,
        code: r.code,
        warning: r.warning,
        alias_id: r.aliasId,
        role_key: r.roleKey,
      });
    }
  }

  // 6. Audit (без значений). Для TR — только tr_id + rows_count + cell-codes counter.
  await service.from('audit_logs').insert({
    action: 'package_tokens_dry_run',
    actor_user_id: actorId,
    actor_type: 'user',
    actor_label: 'super_admin_dry_run',
    meta: {
      package_session_id: sessionId,
      alias_tokens_count: aliasTokens.length,
      alias_tokens: aliasTokens,
      package_template_item_id: packageTemplateItemId,
      codes: codeCounts,
      table_repeats: trAuditSummaries,
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
