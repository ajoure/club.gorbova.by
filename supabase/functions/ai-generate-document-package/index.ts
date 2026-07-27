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
import {
  resolveSmartDatePrefill,
  isValidSmartDatePrefill,
} from '../_shared/smart-date-prefill.ts';
import { resolvePerRoleRecipients } from '../_shared/resolve-per-role-recipients.ts';
import {
  LN_SUB_FIELD_BY_KEY,
  extractLnSubFieldRaw,
  type LnSubFieldSpec,
} from '../_shared/ln-subfield-spec.ts';

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
// PATCH-ROLE-SCOPED-PERSON-PLACEHOLDERS-V1: ln-XXXXXX.<sub_field> ДОЛЖЕН проверяться ДО LN_RE.
const LN_SUB_RE = /^(ln-\d{6})\.([a-z_]+)((?:\|[a-z_]+=[A-Za-z0-9_.]+)*)$/;
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
    const body = await req.json().catch(() => ({}));
    const packageSessionId: string | undefined = body?.package_session_id;
    // HOTFIX 2026-07-27: after signing-key rotation the raw-string Bearer
    // comparison against SERVICE_KEY became fragile across isolates. We now
    // require the x-internal-call marker AND a JWT whose `role` claim equals
    // `service_role`. Signature is not re-verified here — the gateway already
    // validated it upstream; we only decode the payload to read the claim.
    const authHeaderRaw = req.headers.get('Authorization') || '';
    const internalMarker = req.headers.get('x-internal-call');
    function decodeJwtRole(h: string): string | null {
      if (!h.startsWith('Bearer ')) return null;
      const parts = h.slice(7).split('.');
      if (parts.length < 2) return null;
      try {
        const pad = parts[1] + '==='.slice((parts[1].length + 3) % 4);
        const json = atob(pad.replace(/-/g, '+').replace(/_/g, '/'));
        const claims = JSON.parse(json);
        return typeof claims?.role === 'string' ? claims.role : null;
      } catch { return null; }
    }
    const jwtRole = decodeJwtRole(authHeaderRaw);
    // Fallback: some newer key formats (sb_secret_*) are opaque, not JWTs.
    // In that case we accept an exact match against our own SUPABASE_SERVICE_ROLE_KEY.
    const tokenMatchesLocalServiceKey =
      authHeaderRaw.startsWith('Bearer ') && authHeaderRaw.slice(7) === SERVICE_KEY && !!SERVICE_KEY;
    const trustedExternalCall =
      internalMarker === 'external-document-form' &&
      (jwtRole === 'service_role' || tokenMatchesLocalServiceKey);
    if (internalMarker === 'external-document-form') {
      console.log('[ai-generate-document-package] internal-call diag', JSON.stringify({
        has_auth: !!authHeaderRaw, auth_len: authHeaderRaw.length,
        jwt_role: jwtRole, token_matches_service_key: tokenMatchesLocalServiceKey,
        service_key_len: (SERVICE_KEY || '').length,
        service_key_prefix: (SERVICE_KEY || '').slice(0, 8),
        auth_prefix: authHeaderRaw.slice(7, 15),
      }));
    }
    const runMode: 'user_generate' | 'admin_test' | 'external_submit' =
      body?.run_mode === 'admin_test'
        ? 'admin_test'
        : (trustedExternalCall && body?.run_mode === 'external_submit' ? 'external_submit' : 'user_generate');
    if (!packageSessionId) return j({ error: 'package_session_id_required' }, 400);

    // ── load session + ownership ─────────────────────────────────────────
    const { data: session } = await supabase
      .from('document_package_sessions')
      .select('id, profile_id, package_template_id, selected_legal_entity_id, status, created_at, metadata')
      .eq('id', packageSessionId)
      .maybeSingle();
    if (!session) return j({ error: 'package_session_not_found' }, 404);

    let userId: string;
    let prof: { id: string } | null = null;
    if (trustedExternalCall) {
      const { data: owner } = await supabase
        .from('profiles').select('id, user_id').eq('id', session.profile_id).maybeSingle();
      if (!owner?.user_id) return j({ error: 'profile_not_found' }, 400);
      userId = owner.user_id;
      prof = { id: owner.id };
    } else {
      const auth = req.headers.get('Authorization');
      if (!auth?.startsWith('Bearer ')) return j({ error: 'unauthorized' }, 401);
      const { data: ud } = await supabase.auth.getUser(auth.slice(7));
      if (!ud?.user) return j({ error: 'unauthorized' }, 401);
      userId = ud.user.id;
      const { data: ownProfile } = await supabase
        .from('profiles').select('id').eq('user_id', userId).maybeSingle();
      if (!ownProfile) return j({ error: 'profile_not_found' }, 400);
      prof = ownProfile;
    }

    if (runMode === 'admin_test') {
      const { data: roleRows } = await supabase
        .from('user_roles_v2').select('roles!inner(code)').eq('user_id', userId);
      const codes = (roleRows || []).map((r: any) => r.roles?.code);
      const isSuperAdmin = codes.includes('super_admin') || codes.includes('owner') || codes.includes('admin');
      if (!isSuperAdmin) return j({ error: 'forbidden_admin_test' }, 403);
    } else if (!trustedExternalCall && session.profile_id !== prof!.id) {
      return j({ error: 'forbidden' }, 403);
    }

    // ── load items + templates ───────────────────────────────────────────
    const requestedItemId = typeof body?.package_template_item_id === 'string'
      ? body.package_template_item_id : null;
    const { data: allItems } = await supabase
      .from('document_package_template_items')
      .select('id, package_template_id, template_id, title_override, sort_order, generation_mode, repeat_role_catalog_id')
      .eq('package_template_id', session.package_template_id)
      .order('sort_order', { ascending: true });
    const items = requestedItemId ? (allItems ?? []).filter((i: any) => i.id === requestedItemId) : allItems;
    if (requestedItemId && (!items || items.length !== 1)) return j({ error: 'package_item_not_found' }, 404);
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
      .select('id, public_id, role_key, label, output_template, is_active, package_template_id')
      .eq('package_template_id', session.package_template_id);
    const roleByPublicId = new Map<string, any>((roleRows || []).map((r: any) => [r.public_id, r]));
    const roleById = new Map<string, any>((roleRows || []).map((r: any) => [r.id, r]));

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
          .select('field_catalog_id, package_template_item_id, value_text, value_number, value_date, value_datetime, value_time, value_boolean, value_json')
          .eq('session_id', packageSessionId)
          .in('field_catalog_id', pfCatalogIds)
      : { data: [] as any[] } as any;
    // Per-item override map + session-level fallback map.
    const pfValueSessionByField = new Map<string, any>();
    const pfValueItemFieldMap = new Map<string, any>(); // key: `${itemId}::${fieldId}`
    for (const v of (pfValueRows || []) as any[]) {
      if (v.package_template_item_id) {
        pfValueItemFieldMap.set(`${v.package_template_item_id}::${v.field_catalog_id}`, v);
      } else {
        pfValueSessionByField.set(v.field_catalog_id, v);
      }
    }
    function pfValueFor(itemId: string, fieldId: string) {
      return pfValueItemFieldMap.get(`${itemId}::${fieldId}`) ?? pfValueSessionByField.get(fieldId) ?? null;
    }

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
      // PATCH-ROLE-SCOPED-PERSON-PLACEHOLDERS-V1: bag для {{ln-XXXXXX.<sub_field>}}.
      // Ключ — `${lnPublicId}.${subField}`. Хранит raw-значения per-person,
      // strict сам применяет format/case при рендере.
      const preresolved_ln_subfield_tokens: Record<string, {
        ln_public_id: string;
        sub_field: string;
        kind: LnSubFieldSpec['kind'];
        supports_case: boolean;
        multi_policy: 'join' | 'error';
        role_catalog_id: string;
        person_ids: string[];
        raw_values: string[];
      }> = {};
      // PATCH-PACKAGE-CUSTOM-FIELDS-V1 (B4): pf-XXXXXX preresolved bag.
      const preresolved_pf_fields: Record<string, {
        public_id: string;
        label: string;
        data_type: string;
        raw_value: unknown;
        rendered_value: string;
        effective_required: boolean;
        default_kind_applied: string | null;
      }> = {};
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
        // PATCH-ROLE-SCOPED-PERSON-PLACEHOLDERS-V1: ln-sub проверяем до ln (re-anchor).
        else if ((mm = inside.match(LN_SUB_RE))) baseKey = `${mm[1]}.${mm[2]}`;
        else if ((mm = inside.match(LN_RE))) baseKey = mm[1];
        else if ((mm = inside.match(PF_RE))) baseKey = mm[1];
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

        // PATCH-ROLE-SCOPED-PERSON-PLACEHOLDERS-V1: ln-XXXXXX.<sub_field>
        if ((mm = inside.match(LN_SUB_RE))) {
          const lnPublicId = mm[1];
          const subField = mm[2];
          const role = roleByPublicId.get(lnPublicId);
          if (!role) { itemErrors.push(`ln_token_unknown:${lnPublicId}`); continue; }
          if (role.package_template_id !== session.package_template_id) {
            itemErrors.push(`ln_token_outside_bound_package:${lnPublicId}`);
            continue;
          }
          const spec = LN_SUB_FIELD_BY_KEY.get(subField);
          if (!spec) {
            itemErrors.push(`ln_subfield_unknown:${lnPublicId}.${subField}`);
            continue;
          }
          const k = `${item.id}::${role.id}`;
          const asgs = assignByItemRole.get(k) || [];
          if (asgs.length === 0) {
            itemErrors.push(`role_assignment_missing:${lnPublicId}.${subField}`);
            continue;
          }
          const rawValues: string[] = [];
          const personIds: string[] = [];
          for (const a of asgs) {
            if (!a.person_id) continue;
            const p = personMap.get(a.person_id);
            if (!p) continue;
            const v = extractLnSubFieldRaw(p as Record<string, unknown>, spec);
            rawValues.push(v);
            personIds.push(a.person_id);
          }
          if (personIds.length === 0) {
            itemErrors.push(`role_person_not_found:${lnPublicId}.${subField}`);
            continue;
          }
          preresolved_ln_subfield_tokens[`${lnPublicId}.${subField}`] = {
            ln_public_id: lnPublicId,
            sub_field: subField,
            kind: spec.kind,
            supports_case: spec.supports_case,
            multi_policy: spec.multi_policy,
            role_catalog_id: role.id,
            person_ids: personIds,
            raw_values: rawValues,
          };
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
          // Stage C runtime fix: если этот item генерируется в режиме per_role_person
          // и текущий ln-токен == repeat-роль — НЕ блокируем pre-scan по отсутствию
          // назначений (recipient'ы придут из resolvePerRoleRecipients в per-role ветке
          // ниже и перезапишут placeholder).
          const isRepeatRolePerRole =
            item.generation_mode === 'per_role_person' &&
            item.repeat_role_catalog_id &&
            role.id === item.repeat_role_catalog_id;
          const k = `${item.id}::${role.id}`;
          const asgs = assignByItemRole.get(k) || [];
          if (asgs.length === 0) {
            if (isRepeatRolePerRole) {
              // Placeholder; per-role ветка позднее перезапишет под каждого recipient.
              (preresolved_ln_tokens as any)[lnPublicId] = {
                value: '',
                persons: [],
                positions: [],
                position_genders: [],
                role_catalog_id: role.id,
                person_id: null,
              };
              continue;
            }
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
            if (isRepeatRolePerRole) {
              (preresolved_ln_tokens as any)[lnPublicId] = {
                value: '',
                persons: [],
                positions: [],
                position_genders: [],
                role_catalog_id: role.id,
                person_id: null,
              };
              continue;
            }
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

        // PATCH-PACKAGE-CUSTOM-FIELDS-V1 (B4): {{pf-XXXXXX[|format=…]}} (per-package custom field).
        if ((mm = inside.match(PF_RE))) {
          const pfPublicId = mm[1];
          const field = pfCatalogByPublicId.get(pfPublicId);
          if (!field) { itemErrors.push(`pf_token_not_found:${pfPublicId}`); continue; }
          if (field.package_template_id !== session.package_template_id) {
            itemErrors.push(`pf_token_outside_bound_package:${pfPublicId}`);
            continue;
          }
          const asg = pfAssignByItemField.get(`${item.id}::${field.id}`);
          const effective_required: boolean = typeof asg?.is_required_override === 'boolean'
            ? asg.is_required_override
            : !!field.required;
          const label: string = asg?.label_override || field.label || pfPublicId;
          let raw = extractPfRawValue(field, pfValueFor(item.id, field.id));
          // Stage 0.3 (smart-date readiness alignment): если БД-значения нет,
          // но у поля настроен валидный options.default_kind — материализуем
          // prefill, чтобы generator увидел то же, что UI считает заполненным.
          let default_kind_applied: string | null = null;
          const optsDefaultKind =
            field.options && typeof field.options === 'object'
              ? (field.options as any).default_kind
              : null;
          if (
            (raw == null || raw === '') &&
            typeof optsDefaultKind === 'string' &&
            optsDefaultKind !== 'none'
          ) {
            const prefill = resolveSmartDatePrefill(optsDefaultKind, {
              sessionCreatedAt: (session as any)?.created_at ?? null,
              dataType: field.data_type,
            });
            if (prefill && isValidSmartDatePrefill(prefill, field.data_type)) {
              raw = field.data_type === 'year' ? Number(prefill) : prefill;
              default_kind_applied = optsDefaultKind;
            }
          }
          // Legacy fallback: некоторые исторические записи держали default_kind
          // в metadata вместо options. Сохраняем для совместимости снапшота.
          if (
            !default_kind_applied &&
            field.metadata &&
            typeof field.metadata === 'object' &&
            typeof (field.metadata as any).default_kind === 'string'
          ) {
            default_kind_applied = (field.metadata as any).default_kind;
          }
          const fmt = formatPfValue(field.data_type, raw, field.options, undefined);
          const rendered = 'value' in fmt ? fmt.value : '';
          preresolved_pf_fields[pfPublicId] = {
            public_id: pfPublicId,
            label,
            data_type: field.data_type,
            raw_value: raw,
            rendered_value: rendered,
            effective_required,
            default_kind_applied,
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



      // ── PATCH-PACKAGE-REPEATABLE-DOCUMENTS-BY-ROLE-V1 (Stage C) ─────────
      // Если item.generation_mode='per_role_person' — генерируем N документов
      // (по одному на recipient), переопределяя preresolved_ln_tokens для
      // repeat-роли (compatibility) и прокидывая полный recipient context
      // (canonical SoT для {{recipient.*}}).
      const isPerRole = item.generation_mode === 'per_role_person';

      type StrictPlan = {
        packageContextExtras: Record<string, unknown>;
        lnTokens: typeof preresolved_ln_tokens;
        lnSubFieldTokens: typeof preresolved_ln_subfield_tokens;
        recipientMeta: { assignment_id: string; person_id: string; role_catalog_id: string; sort_order: number; index: number } | null;
      };
      const plans: StrictPlan[] = [];

      if (!isPerRole) {
        plans.push({
          packageContextExtras: { generation_mode: 'single' },
          lnTokens: preresolved_ln_tokens,
          lnSubFieldTokens: preresolved_ln_subfield_tokens,
          recipientMeta: null,
        });
      } else {
        const res = await resolvePerRoleRecipients(supabase, {
          session_id: packageSessionId,
          item_id: item.id,
        });
        if (res.status === 'ok' && res.recipients.length > 0) {
          const repeatRole = roleById.get(res.repeat_role_catalog_id || '');
          const repeatRolePublicId: string | null = repeatRole?.public_id ?? null;
          let idx = 0;
          for (const rcp of res.recipients) {
            idx += 1;
            const lnClone: Record<string, any> = { ...preresolved_ln_tokens };
            // Compatibility ln-* override: только если шаблон ссылается на эту роль
            // через ln-token (ключ есть в bag). Иначе документ всё равно рендерится N раз
            // через {{recipient.*}}; ln прочих ролей не трогаем.
            if (repeatRolePublicId && Object.prototype.hasOwnProperty.call(lnClone, repeatRolePublicId)) {
              lnClone[repeatRolePublicId] = {
                value: rcp.recipient.full_name,
                persons: [rcp.recipient.full_name],
                positions: [rcp.recipient.position ?? ''],
                position_genders: [null],
                role_catalog_id: rcp.role_catalog_id,
                person_id: rcp.person_id,
              };
            }
            // PATCH-ROLE-SCOPED-PERSON-PLACEHOLDERS-V1: per-recipient override
            // sub-field bag для repeat-роли — оставляем только данные ОДНОГО получателя.
            const lnSubClone: Record<string, any> = {};
            const recipientPerson = personMap.get(rcp.person_id);
            for (const [bagKey, entry] of Object.entries(preresolved_ln_subfield_tokens)) {
              if (entry.ln_public_id === repeatRolePublicId && recipientPerson) {
                const spec = LN_SUB_FIELD_BY_KEY.get(entry.sub_field);
                if (spec) {
                  lnSubClone[bagKey] = {
                    ...entry,
                    person_ids: [rcp.person_id],
                    raw_values: [extractLnSubFieldRaw(recipientPerson as Record<string, unknown>, spec)],
                  };
                  continue;
                }
              }
              lnSubClone[bagKey] = entry;
            }
            plans.push({
              lnTokens: lnClone,
              lnSubFieldTokens: lnSubClone,
              packageContextExtras: {
                generation_mode: 'per_role_person',
                repeat_role_catalog_id: res.repeat_role_catalog_id,
                repeat_assignment_id: rcp.assignment_id,
                recipient_person_id: rcp.person_id,
                recipient_index: idx,
                recipient_display_name: rcp.recipient.full_name,
                recipient: {
                  full_name: rcp.recipient.full_name,
                  short_name: rcp.recipient.short_name,
                  email: rcp.recipient.email,
                  phone: rcp.recipient.phone,
                  address: rcp.recipient.address,
                  position: rcp.recipient.position,
                },
              },
              recipientMeta: {
                assignment_id: rcp.assignment_id,
                person_id: rcp.person_id,
                role_catalog_id: rcp.role_catalog_id,
                sort_order: rcp.sort_order,
                index: idx,
              },
            });
          }
        } else {
          // resolver не дал получателей — единая запись по item, генерация не запускается.
          const statusToError: Record<string, string> = {
            no_active_assignments: 'per_role_no_active_recipients',
            role_not_configured: 'per_role_role_not_configured',
            role_inactive: 'per_role_role_inactive',
            role_package_mismatch: 'per_role_role_package_mismatch',
            item_outside_session_package: 'per_role_item_outside_session_package',
            session_not_found: 'per_role_session_not_found',
            item_not_found: 'per_role_item_not_found',
            resolver_error: 'per_role_resolver_error',
            single_mode: 'per_role_single_mode_inconsistency',
          };
          const code = statusToError[res.status] || 'per_role_unknown_status';
          const isBlocked = res.status === 'no_active_assignments';
          if (isBlocked) blocked++; else errors++;
          results.push({
            item_id: item.id,
            template_id: tpl.id,
            generation_mode: 'per_role_person',
            status: isBlocked ? 'blocked' : 'error',
            errors: [code, ...(res.reasons || [])],
          });
          continue;
        }
      }

      // ── invoke strict in package mode (service-role + internal marker) ─
      for (const plan of plans) {
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
              preresolved_ln_tokens: plan.lnTokens,
              preresolved_ln_subfield_tokens: plan.lnSubFieldTokens,
              preresolved_pf_fields,
              external_submission_id: (session.metadata as any)?.external_submission_id ?? null,
              ...plan.packageContextExtras,
            },
          }),
        });
        const strictBody: any = await strictRes.json().catch(() => ({}));
        if (!strictRes.ok || !strictBody?.success) {
          errors++;
          results.push({
            item_id: item.id,
            template_id: tpl.id,
            generation_mode: isPerRole ? 'per_role_person' : 'single',
            status: 'error',
            errors: [strictBody?.error || `http_${strictRes.status}`],
            details: strictBody,
            ...(plan.recipientMeta ? { recipient: plan.recipientMeta } : {}),
          });
          continue;
        }
        generated++;
        results.push({
          item_id: item.id,
          template_id: tpl.id,
          generation_mode: isPerRole ? 'per_role_person' : 'single',
          status: 'generated',
          document_id: strictBody.document_id,
          document_number: strictBody.document_number,
          document_date: strictBody.document_date,
          download_url: strictBody.download_url,
          ...(plan.recipientMeta ? { recipient: plan.recipientMeta } : {}),
        });
      }
    }

    let finalStatus: 'generated' | 'partial' | 'failed' | 'blocked' = 'generated';
    if (generated === 0 && (errors > 0 || blocked > 0)) finalStatus = blocked > errors ? 'blocked' : 'failed';
    else if (errors > 0 || blocked > 0) finalStatus = 'partial';

    // PATCH-PACKAGE-REPEATABLE-DOCUMENTS-BY-ROLE-V1 (Stage C):
    // total_items — число позиций шаблона; total_documents — фактическое число документов
    // (generated + errors + blocked). Раздельные счётчики не пересекаются.
    const totalDocuments = generated + errors + blocked;

    await supabase
      .from('ai_document_generation_batches')
      .update({
        status: finalStatus,
        meta: {
          package_session_id: packageSessionId,
          run_mode: runMode,
          total_items: items.length,
          total_documents: totalDocuments,
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
        total_items: items.length,
        total_documents: totalDocuments,
        generated,
        errors,
        blocked,
      },
    });

    const responsePayload = {
      success: finalStatus === 'generated' || finalStatus === 'partial',
      batch_id: batch.id,
      status: finalStatus,
      total_items: items.length,
      total_documents: totalDocuments,
      generated,
      errors,
      blocked,
      results,
    };
    console.log('[ai-generate-document-package] final-response', JSON.stringify({
      session: packageSessionId, status: finalStatus, total_documents: totalDocuments,
      generated, errors_count: errors?.length ?? 0, blocked_count: blocked?.length ?? 0,
      results_summary: (results || []).map((r: any) => ({ item_id: r.item_id, status: r.status, errors: r.errors, document_id: r.document_id })),
    }));
    return j(responsePayload);
  } catch (e: any) {
    console.error('ai-generate-document-package error:', e);
    return j({ error: e?.message || 'internal_error' }, 500);
  }
});
