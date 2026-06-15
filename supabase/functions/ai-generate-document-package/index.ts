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
import { formatPfValue } from '../_shared/resolve-package-tokens.ts';

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

const FIELD_RE = /^field:(FLD-\d{6})((?:\|[a-z_]+=[A-Za-z0-9_.]+)*)$/;
const PACKAGE_FLD_RE = /^package\.(ul|ip|fl)\.(FLD-\d{6})((?:\|[a-z_]+=[A-Za-z0-9_.]+)*)$/;
const LN_RE = /^(ln-\d{6})((?:\|[a-z_]+=[A-Za-z0-9_.]+)*)$/;
// PATCH-PACKAGE-CUSTOM-FIELDS-V1 (B4): pf-XXXXXX custom-field placeholders.
const PF_RE = /^(pf-\d{6})((?:\|[a-z_]+=[A-Za-z0-9_.]+)*)$/;
const TOKEN_RE = /\{\{([^}]+)\}\}/g;

// Sprint 3J-Roles: FIO-полей пакета, для которых orchestrator сохраняет raw_full_name
// (зеркалит whitelist в canonical-document-generate-strict).
const FIO_PACKAGE_TECH_KEYS: ReadonlySet<string> = new Set([
  'package.ul.director_full_name',
  'package.ul.director_short_name',
  'package.fl.full_name',
  'package.fl.full_name_short',
]);

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
      .select('id, name, current_version_id, file_name_template')
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

    // ── PATCH-PACKAGE-CUSTOM-FIELDS-V1 (B4): pf-XXXXXX catalog + values + assignments ──
    const { data: pfCatalogRows } = await supabase
      .from('document_package_field_catalog')
      .select('id, public_id, package_template_id, field_key, data_type, options, required, is_active, label, metadata')
      .eq('package_template_id', session.package_template_id)
      .eq('is_active', true);
    const pfCatalogByPublicId = new Map<string, any>(
      (pfCatalogRows || []).map((r: any) => [r.public_id, r]),
    );
    const pfCatalogIds = (pfCatalogRows || []).map((r: any) => r.id);

    const { data: pfAssignmentRows } = pfCatalogIds.length
      ? await supabase
          .from('document_package_item_field_assignments')
          .select('id, package_template_item_id, field_catalog_id, is_required_override, label_override, metadata, is_active')
          .in('package_template_item_id', itemIds)
          .in('field_catalog_id', pfCatalogIds)
          .eq('is_active', true)
      : { data: [] as any[] } as any;
    const pfAssignByItemField = new Map<string, any>();
    for (const a of (pfAssignmentRows || []) as any[]) {
      pfAssignByItemField.set(`${a.package_template_item_id}::${a.field_catalog_id}`, a);
    }

    const { data: pfValueRows } = pfCatalogIds.length
      ? await supabase
          .from('document_package_session_field_values')
          .select('field_catalog_id, value_text, value_number, value_date, value_datetime, value_time, value_boolean, value_json')
          .eq('session_id', packageSessionId)
          .in('field_catalog_id', pfCatalogIds)
      : { data: [] as any[] } as any;
    const pfValueByField = new Map<string, any>(
      (pfValueRows || []).map((v: any) => [v.field_catalog_id, v]),
    );

    function extractPfRawValue(field: any, valueRow: any): unknown {
      if (!valueRow) return null;
      switch (field.data_type) {
        case 'text':
        case 'select': return valueRow.value_text;
        case 'number':
        case 'year': return valueRow.value_number;
        case 'date': return valueRow.value_date;
        case 'datetime': return valueRow.value_datetime;
        case 'time': return valueRow.value_time;
        case 'checkbox': return valueRow.value_boolean;
        case 'multiselect': return valueRow.value_json;
        default: return null;
      }
    }


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
      const docxFlat = stripXml(extractDocumentXmlText(zip));
      // Sprint 3M: file_name_template токены тоже учитываем при сборе FLD/package/ln,
      // чтобы system-FLD (FLD-000133 и т.п.), используемые только в имени файла,
      // попадали в preresolved_fields / preresolved_package_fields / preresolved_ln_tokens.
      const fnTemplate: string = (tpl as any).file_name_template || '';
      const flat = `${docxFlat}\n${fnTemplate}`;

      const preresolved_fields: Record<string, { value: string; source: string }> = {};
      const preresolved_package_fields: Record<string, { value: string; source: string; catalog_tech_key: string }> = {};
      const preresolved_ln_tokens: Record<string, { value: string; persons: string[]; positions: string[]; position_genders: Array<'m'|'f'|null>; role_catalog_id: string; person_id: string }> = {};
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
        // Sprint 3J-Roles: дедупликация по base public_id (без модификаторов),
        // т.к. strict читает bag по public_id и применяет модификаторы сам.
        let mm: RegExpMatchArray | null;
        let baseKey: string | null = null;
        if ((mm = inside.match(FIELD_RE))) baseKey = `field:${mm[1]}`;
        else if ((mm = inside.match(PACKAGE_FLD_RE))) baseKey = `package.${mm[1]}.${mm[2]}`;
        else if ((mm = inside.match(LN_RE))) baseKey = mm[1];
        else baseKey = inside;
        if (seen.has(baseKey)) continue;
        seen.add(baseKey);

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
          if (SYSTEM_FIELD_VALUE_IDS.has(fld)) {
            preresolved_fields[fld] = {
              value: sysVals[fld],
              source: 'system_field_value',
            };
            continue;
          }
          itemErrors.push(`system_field_resolver_not_implemented:${fld}`);
          continue;
        }

        if ((mm = inside.match(PACKAGE_FLD_RE))) {
          const groupShort = mm[1] as 'ul' | 'ip' | 'fl';
          const fld = mm[2];
          const bagKey = `package.${groupShort}.${fld}`;
          // Поиск catalog item по базовому токену без модификаторов.
          const baseToken = bagKey;
          const item3 = findByPackageToken(baseToken);
          if (!item3) { itemErrors.push(`package_token_unknown:${baseToken}`); continue; }
          if (item3.status !== 'copy_ready') { itemErrors.push(`package_field_not_ready:${baseToken}:${item3.status}`); continue; }
          const isFl = item3.groupId === 'package_fl';
          const isFio = FIO_PACKAGE_TECH_KEYS.has(item3.tech_key);
          if (!isFl) {
            if (!legalEntityRow) { itemErrors.push(`package_legal_entity_not_selected`); continue; }
            const val = formatPackageFieldValue(
              item3.tech_key,
              item3.groupId as 'package_ul' | 'package_ip',
              legalEntityRow,
            );
            const entry: any = {
              value: val,
              source: item3.source_path!,
              catalog_tech_key: item3.tech_key,
            };
            if (isFio) {
              // raw_full_name для strict re-формата (format=full|short|signature_short).
              entry.raw_full_name = String((legalEntityRow as any).leg_director_name || '').trim();
            }
            preresolved_package_fields[bagKey] = entry;
          } else {
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
            const entry: any = {
              value: val,
              source: item3.source_path!,
              catalog_tech_key: item3.tech_key,
            };
            if (isFio) {
              entry.raw_full_name = String((person as any).full_name || '').trim();
            }
            preresolved_package_fields[bagKey] = entry;
          }
          continue;
        }

        if ((mm = inside.match(LN_RE))) {
          const lnPublicId = mm[1];
          const role = roleByPublicId.get(lnPublicId);
          if (!role) { itemErrors.push(`ln_token_unknown:${lnPublicId}`); continue; }
          if (role.package_template_id !== session.package_template_id) {
            itemErrors.push(`ln_token_outside_bound_package:${lnPublicId}`);
            continue;
          }
          const k = `${item.id}::${role.id}`;
          const asgs = assignByItemRole.get(k) || [];
          if (asgs.length === 0) {
            itemErrors.push(`role_assignment_missing:${lnPublicId}`);
            continue;
          }
          const fullNames: string[] = [];
          const positions: string[] = [];
          const positionGenders: Array<'m'|'f'|null> = [];
          let firstPersonId: string | null = null;
          for (const a of asgs) {
            if (!a.person_id) continue;
            const p = personMap.get(a.person_id);
            if (!p) continue;
            const fn = String((p as any).full_name || '').trim();
            if (!fn) continue;
            if (!firstPersonId) firstPersonId = a.person_id;
            fullNames.push(fn);
            // Sprint 3L: per-assignment должность из metadata.position +
            // опциональный metadata.position_gender ('m'|'f').
            const md = (a.metadata ?? {}) as Record<string, unknown>;
            const pos = typeof md.position === 'string' ? md.position.trim() : '';
            positions.push(pos);
            const pg = md.position_gender === 'f' ? 'f' : md.position_gender === 'm' ? 'm' : null;
            positionGenders.push(pg);
          }
          if (fullNames.length === 0 || !firstPersonId) {
            itemErrors.push(`role_person_not_found:${lnPublicId}`);
            continue;
          }
          // Sprint 3J-Roles: bag key = base public_id (без модификаторов).
          // strict читает entry.persons[] и применяет format/case per-person.
          // Sprint 3L: + entry.positions[] / entry.position_genders[] для include_position.
          (preresolved_ln_tokens as any)[lnPublicId] = {
            value: fullNames.join('; '),
            persons: fullNames,
            positions,
            position_genders: positionGenders,
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
