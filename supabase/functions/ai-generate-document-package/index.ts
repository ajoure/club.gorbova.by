// ============================================================================
// ai-generate-document-package — Sprint 3I-A thin orchestrator.
//
// NEVER renders DOCX, NEVER calls Gotenberg, NEVER writes ai_generated_documents
// directly. All generation goes through canonical-document-generate-strict via
// internal service-role HTTP call with `x-internal-call: package-orchestrator`.
//
// Body: { package_session_id, run_mode? = 'user_generate' | 'admin_test' }
//
// Preflight (per item, blocker → strict NOT invoked for that item):
//   • role_assignment_missing      — {{ln-XXXXXX}} present, no active assignment
//   • ln_token_unknown             — ln catalog row not found
//   • ln_token_outside_bound_package — role belongs to a different package_template
//   • package_field_not_ready      — package.* not copy_ready in catalog
//   • package_legal_entity_not_selected — UL/IP token but no selected_legal_entity_id
//   • package_token_unknown        — package.* not in catalog
//   • billing_field_in_package_template — billing-only FLD detected in package
//   • package_fl_role_context_missing  — multiple FL roles, ambiguous person
// ============================================================================

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2';
import PizZip from 'npm:pizzip@3.1.6';
import {
  PACKAGE_PLACEHOLDER_CATALOG,
  findByPackageToken,
} from '../_shared/packagePlaceholderCatalog.ts';
import { formatPackageFieldValue } from '../_shared/packageFieldFormatter.ts';
import {
  buildSystemFieldValues,
  SYSTEM_FIELD_VALUE_IDS,
} from '../_shared/system-field-values.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Billing entity types (mirror src/utils/billingFldGroups.ts).
const BILLING_ENTITY_TYPES = new Set([
  'customer', 'customer_ent', 'customer_ind', 'customer_leg', 'customer_signer',
  'executor', 'executor_leg',
]);

// System / allowed-in-package fields.
const ALLOWED_FIELD_ENTITY_TYPES = new Set([
  'system', 'document', 'meeting', 'agenda', 'decision', 'package',
]);

const FIELD_RE = /^field:(FLD-\d{6})$/;
const PACKAGE_FLD_RE = /^package\.(ul|ip|fl)\.(FLD-\d{6})$/;
const LN_RE = /^ln-\d{6}$/;
const TOKEN_RE = /\{\{([^}]+)\}\}/g;

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function extractDocumentXmlText(zip: PizZip): string {
  const f = zip.file('word/document.xml');
  return f ? f.asText() : '';
}

function stripXml(xml: string): string {
  return xml.replace(/<[^>]+>/g, '');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // ── auth ─────────────────────────────────────────────────────────────
    const auth = req.headers.get('Authorization');
    if (!auth?.startsWith('Bearer ')) return j({ error: 'unauthorized' }, 401);
    const { data: ud } = await supabase.auth.getUser(auth.slice(7));
    if (!ud?.user) return j({ error: 'unauthorized' }, 401);
    const userId = ud.user.id;

    const { data: prof } = await supabase
      .from('profiles').select('id').eq('user_id', userId).maybeSingle();
    if (!prof) return j({ error: 'profile_not_found' }, 400);

    const body = await req.json().catch(() => ({}));
    const packageSessionId: string | undefined = body?.package_session_id;
    const runMode: 'user_generate' | 'admin_test' =
      body?.run_mode === 'admin_test' ? 'admin_test' : 'user_generate';
    if (!packageSessionId) return j({ error: 'package_session_id_required' }, 400);

    // ── load session + ownership ─────────────────────────────────────────
    const { data: session } = await supabase
      .from('document_package_sessions')
      .select('id, profile_id, package_template_id, selected_legal_entity_id, status')
      .eq('id', packageSessionId)
      .maybeSingle();
    if (!session) return j({ error: 'package_session_not_found' }, 404);

    if (runMode === 'admin_test') {
      const { data: roleRows } = await supabase
        .from('user_roles_v2').select('roles!inner(code)').eq('user_id', userId);
      const codes = (roleRows || []).map((r: any) => r.roles?.code);
      const isSuperAdmin = codes.includes('super_admin') || codes.includes('owner') || codes.includes('admin');
      if (!isSuperAdmin) return j({ error: 'forbidden_admin_test' }, 403);
    } else if (session.profile_id !== prof.id) {
      return j({ error: 'forbidden' }, 403);
    }

    // ── load items + templates ───────────────────────────────────────────
    const { data: items } = await supabase
      .from('document_package_template_items')
      .select('id, package_template_id, template_id, title_override, sort_order')
      .eq('package_template_id', session.package_template_id)
      .order('sort_order', { ascending: true });
    if (!items || items.length === 0) return j({ error: 'package_has_no_items' }, 400);

    const templateIds = Array.from(new Set(items.map((i: any) => i.template_id).filter(Boolean)));
    const { data: tpls } = await supabase
      .from('document_templates')
      .select('id, name, current_version_id')
      .in('id', templateIds.length ? templateIds : ['__none__']);
    const tplMap = new Map<string, any>((tpls || []).map((t: any) => [t.id, t]));

    const verIds = (tpls || []).map((t: any) => t.current_version_id).filter(Boolean);
    const { data: vers } = await supabase
      .from('document_template_versions')
      .select('id, storage_bucket, storage_path')
      .in('id', verIds.length ? verIds : ['__none__']);
    const verMap = new Map<string, any>((vers || []).map((v: any) => [v.id, v]));

    // ── load UL/IP source row (single per session) ──────────────────────
    let legalEntityRow: any = null;
    if (session.selected_legal_entity_id) {
      const { data: ld } = await supabase
        .from('client_legal_details')
        .select('*')
        .eq('id', session.selected_legal_entity_id)
        .maybeSingle();
      legalEntityRow = ld || null;
    }

    // ── load role catalog for this package (for ln preflight) ───────────
    const { data: roleRows } = await supabase
      .from('document_package_role_catalog')
      .select('id, public_id, role_key, output_template, is_active, package_template_id')
      .eq('package_template_id', session.package_template_id);
    const roleByPublicId = new Map<string, any>((roleRows || []).map((r: any) => [r.public_id, r]));

    // ── load all item-level role assignments at once ────────────────────
    const itemIds = items.map((i: any) => i.id);
    const { data: assignments } = await supabase
      .from('document_package_item_role_assignments')
      .select('id, package_template_item_id, role_catalog_id, person_id, metadata, sort_order, is_active')
      .eq('package_session_id', packageSessionId)
      .in('package_template_item_id', itemIds)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    const assignByItemRole = new Map<string, any[]>();
    for (const a of (assignments || []) as any[]) {
      const k = `${a.package_template_item_id}::${a.role_catalog_id}`;
      const arr = assignByItemRole.get(k) || [];
      arr.push(a);
      assignByItemRole.set(k, arr);
    }

    // ── load persons referenced ─────────────────────────────────────────
    const personIds = Array.from(new Set((assignments || []).map((a: any) => a.person_id).filter(Boolean)));
    const { data: persons } = await supabase
      .from('legal_details_persons').select('*').in('id', personIds.length ? personIds : ['__none__']);
    const personMap = new Map<string, any>((persons || []).map((p: any) => [p.id, p]));

    // ── create batch (pending) ──────────────────────────────────────────
    const { data: batch, error: batchErr } = await supabase
      .from('ai_document_generation_batches')
      .insert({
        profile_id: session.profile_id,
        package_template_id: session.package_template_id,
        title: `Package ${packageSessionId.slice(0, 8)}`,
        status: 'pending',
        meta: {
          package_session_id: packageSessionId,
          run_mode: runMode,
          total_items: items.length,
          generated: 0,
          errors: 0,
          actor_user_id: userId,
        },
        created_by: userId,
      })
      .select('id')
      .single();
    if (batchErr || !batch) return j({ error: `batch_create_failed:${batchErr?.message}` }, 500);

    // ── per-item preflight + invoke strict ──────────────────────────────
    const results: any[] = [];
    let generated = 0;
    let errors = 0;
    let blocked = 0;

    // Sprint 3I-A-2 F1: системные FLD значения вычисляются один раз на запуск,
    // чтобы все item'ы пакета видели одинаковые today/year/now.
    const sysVals = buildSystemFieldValues(new Date());

    for (const item of items as any[]) {
      const tpl = tplMap.get(item.template_id);
      const ver = tpl ? verMap.get(tpl.current_version_id) : null;
      if (!tpl || !ver) {
        errors++;
        results.push({ item_id: item.id, status: 'error', errors: ['template_or_version_missing'] });
        continue;
      }

      // download DOCX to scan tokens
      const dl = await supabase.storage.from(ver.storage_bucket).download(ver.storage_path);
      if (dl.error) {
        errors++;
        results.push({ item_id: item.id, status: 'error', errors: [`download_failed:${dl.error.message}`] });
        continue;
      }
      const buf = await dl.data.arrayBuffer();
      const zip = new PizZip(buf);
      const flat = stripXml(extractDocumentXmlText(zip));

      const preresolved_fields: Record<string, { value: string; source: string }> = {};
      const preresolved_package_fields: Record<string, { value: string; source: string; catalog_tech_key: string }> = {};
      const preresolved_ln_tokens: Record<string, { value: string; role_catalog_id: string; person_id: string }> = {};
      const itemErrors: string[] = [];
      const seen = new Set<string>();

      // collect all FLD-XXX in template for fields_registry lookup
      const fldIds = new Set<string>();
      for (const m of flat.matchAll(TOKEN_RE)) {
        const inside = m[1].trim();
        const ff = inside.match(FIELD_RE);
        if (ff) fldIds.add(ff[1]);
      }
      let fieldsRegMap = new Map<string, any>();
      if (fldIds.size > 0) {
        const { data: regs } = await supabase
          .from('fields_registry')
          .select('public_id, entity_type, data_type')
          .in('public_id', Array.from(fldIds));
        fieldsRegMap = new Map((regs || []).map((r: any) => [r.public_id, r]));
      }

      for (const m of flat.matchAll(TOKEN_RE)) {
        const inside = m[1].trim();
        if (seen.has(inside)) continue;
        seen.add(inside);

        let mm: RegExpMatchArray | null;
        if ((mm = inside.match(FIELD_RE))) {
          const fld = mm[1];
          // System numbering injection is done inside strict (FLD-000069/070).
          if (fld === 'FLD-000069' || fld === 'FLD-000070') {
            preresolved_fields[fld] = { value: '', source: 'system_generated_placeholder' };
            continue;
          }
          const reg = fieldsRegMap.get(fld);
          const et = (reg?.entity_type || '').toLowerCase();
          if (BILLING_ENTITY_TYPES.has(et)) {
            itemErrors.push(`billing_field_in_package_template:${fld}`);
            continue;
          }
          if (et && !ALLOWED_FIELD_ENTITY_TYPES.has(et)) {
            itemErrors.push(`field_entity_type_not_allowed_in_package:${fld}:${et}`);
            continue;
          }
          // Sprint 3I-A-2 F1: резолв «чистых» system FLD через shared helper.
          // Формат 1-в-1 с order-mode (общий _shared/ru-date.ts).
          if (SYSTEM_FIELD_VALUE_IDS.has(fld)) {
            preresolved_fields[fld] = {
              value: sysVals[fld],
              source: 'system_field_value',
            };
            continue;
          }
          // Любой system FLD вне whitelist → error (никаких silent empty).
          itemErrors.push(`system_field_resolver_not_implemented:${fld}`);
          continue;
        }

        if ((mm = inside.match(PACKAGE_FLD_RE))) {
          const item3 = findByPackageToken(inside);
          if (!item3) { itemErrors.push(`package_token_unknown:${inside}`); continue; }
          if (item3.status !== 'copy_ready') { itemErrors.push(`package_field_not_ready:${inside}:${item3.status}`); continue; }
          const isFl = item3.groupId === 'package_fl';
          if (!isFl) {
            if (!legalEntityRow) { itemErrors.push(`package_legal_entity_not_selected`); continue; }
            // Sprint 3J: значение проходит через те же billing helpers
            // (canonicalizeLegalEntity / formatEntrepreneurDisplayName /
            // formatStructuredAddress / fullNameToInitials), чтобы output
            // совпадал побайтово с биллинговым аналогом.
            const val = formatPackageFieldValue(
              item3.tech_key,
              item3.groupId as 'package_ul' | 'package_ip',
              legalEntityRow,
            );
            preresolved_package_fields[inside] = {
              value: val,
              source: item3.source_path!,
              catalog_tech_key: item3.tech_key,
            };
          } else {
            // FL ambiguity: collect all active assignments for this item that
            // point at FL persons. If exactly one person → use it. Else error.
            const flAssignments = (assignments || []).filter(
              (a: any) => a.package_template_item_id === item.id && a.person_id,
            );
            const distinctPersons = Array.from(new Set(flAssignments.map((a: any) => a.person_id)));
            if (distinctPersons.length === 0) {
              itemErrors.push(`package_fl_role_context_missing:no_person_assigned`);
              continue;
            }
            if (distinctPersons.length > 1) {
              itemErrors.push(`package_fl_role_context_missing:multiple_persons:${distinctPersons.length}`);
              continue;
            }
            const person = personMap.get(distinctPersons[0]);
            if (!person) { itemErrors.push(`package_fl_person_not_found`); continue; }
            const val = formatPackageFieldValue(item3.tech_key, 'package_fl', person);
            preresolved_package_fields[inside] = {
              value: val,
              source: item3.source_path!,
              catalog_tech_key: item3.tech_key,
            };
          }
          continue;
        }

        if (LN_RE.test(inside)) {
          const role = roleByPublicId.get(inside);
          if (!role) { itemErrors.push(`ln_token_unknown:${inside}`); continue; }
          if (role.package_template_id !== session.package_template_id) {
            itemErrors.push(`ln_token_outside_bound_package:${inside}`);
            continue;
          }
          const k = `${item.id}::${role.id}`;
          const asgs = assignByItemRole.get(k) || [];
          if (asgs.length === 0) {
            itemErrors.push(`role_assignment_missing:${inside}`);
            continue;
          }
          // Sprint 3J-Roles: SOT для значения роли = ФИО назначенного человека
          // (без position). Multi-assignment → join `; `. Modifiers (format/case)
          // применяются в canonical-document-generate-strict через formatPersonName.
          const fullNames: string[] = [];
          let firstPersonId: string | null = null;
          for (const a of asgs) {
            if (!a.person_id) continue;
            const p = personMap.get(a.person_id);
            if (!p) continue;
            const fn = String((p as any).full_name || '').trim();
            if (!fn) continue;
            if (!firstPersonId) firstPersonId = a.person_id;
            fullNames.push(fn);
          }
          if (fullNames.length === 0 || !firstPersonId) {
            itemErrors.push(`role_person_not_found:${inside}`);
            continue;
          }
          // Default render = full ФИО, join `; `. Strict re-formats per modifiers
          // (см. preresolved_ln_tokens[inside].persons[]).
          (preresolved_ln_tokens as any)[inside] = {
            value: fullNames.join('; '),
            persons: fullNames,
            role_catalog_id: role.id,
            person_id: firstPersonId,
          };
          continue;
        }

        itemErrors.push(`invalid_token_in_package_template:${inside}`);
      }

      if (itemErrors.length > 0) {
        blocked++;
        results.push({
          item_id: item.id,
          template_id: tpl.id,
          status: 'blocked',
          errors: itemErrors,
        });
        continue;
      }

      // ── invoke strict in package mode (service-role + internal marker) ─
      const strictRes = await fetch(`${SUPABASE_URL}/functions/v1/canonical-document-generate-strict`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'x-internal-call': 'package-orchestrator',
        },
        body: JSON.stringify({
          mode: 'generate',
          packageContext: {
            package_session_id: packageSessionId,
            package_template_id: session.package_template_id,
            package_template_item_id: item.id,
            generation_batch_id: batch.id,
            profile_id: session.profile_id,
            template_id: tpl.id,
            title_override: item.title_override,
            preresolved_fields,
            preresolved_package_fields,
            preresolved_ln_tokens,
          },
        }),
      });
      const strictBody: any = await strictRes.json().catch(() => ({}));
      if (!strictRes.ok || !strictBody?.success) {
        errors++;
        results.push({
          item_id: item.id,
          template_id: tpl.id,
          status: 'error',
          errors: [strictBody?.error || `http_${strictRes.status}`],
          details: strictBody,
        });
        continue;
      }
      generated++;
      results.push({
        item_id: item.id,
        template_id: tpl.id,
        status: 'generated',
        document_id: strictBody.document_id,
        document_number: strictBody.document_number,
        document_date: strictBody.document_date,
        download_url: strictBody.download_url,
      });
    }

    let finalStatus: 'generated' | 'partial' | 'failed' | 'blocked' = 'generated';
    if (generated === 0 && (errors > 0 || blocked > 0)) finalStatus = blocked > errors ? 'blocked' : 'failed';
    else if (errors > 0 || blocked > 0) finalStatus = 'partial';

    await supabase
      .from('ai_document_generation_batches')
      .update({
        status: finalStatus,
        meta: {
          package_session_id: packageSessionId,
          run_mode: runMode,
          total_items: items.length,
          generated,
          errors,
          blocked,
          actor_user_id: userId,
          results,
        },
      })
      .eq('id', batch.id);

    await supabase.from('audit_logs').insert({
      actor_user_id: userId,
      actor_type: runMode === 'admin_test' ? 'admin' : 'user',
      action: 'document.package_generation_completed',
      meta: {
        package_session_id: packageSessionId,
        generation_batch_id: batch.id,
        run_mode: runMode,
        status: finalStatus,
        total: items.length,
        generated,
        errors,
        blocked,
      },
    });

    return j({
      success: finalStatus === 'generated' || finalStatus === 'partial',
      batch_id: batch.id,
      status: finalStatus,
      total: items.length,
      generated,
      errors,
      blocked,
      results,
    });
  } catch (e: any) {
    console.error('ai-generate-document-package error:', e);
    return j({ error: e?.message || 'internal_error' }, 500);
  }
});
