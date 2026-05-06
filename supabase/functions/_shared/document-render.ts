// ============================================================================
// document-render.ts — Canonical DOCX generation core (Sprint 1)
// ----------------------------------------------------------------------------
// Назначение: единая deterministic точка рендера DOCX-документов.
// - Читает feature flag documents_canonical_generation_enabled.
// - Загружает template + актуальную version из document_template_versions
//   (fallback на document_templates.template_path, если version отсутствует).
// - Резолвит токены через document_token_registry:
//     • source_type='system'        → resolver-ключи (executor.*, customer.*,
//       deal.*, document.*, system.*, legal_details.* fallback)
//     • source_type='custom_field'  → значения из field_values по field_id
//   (на Sprint 1 custom_field берём напрямую из client_legal_details колонок,
//    т.к. fields_registry для legal_details — namespaced wrapper)
// - Возвращает payload (resolved_tokens, missing_tokens, snapshot) или
//   рендерит DOCX и сохраняет ai_generated_documents row с idempotency_key.
//
// LEGACY-SAFE: ничего не трогает в существующих edge functions
// (ai-generate-document, generate-from-template, document-auto-generate).
// ============================================================================

// deno-lint-ignore-file no-explicit-any
import Docxtemplater from 'npm:docxtemplater@3.47.1';
import PizZip from 'npm:pizzip@3.1.6';

export const CANONICAL_RESOLVER_VERSION = '1.0.0';
export const CANONICAL_FEATURE_FLAG_KEY = 'documents_canonical_generation_enabled';

export type CanonicalContextType = 'order' | 'manual' | 'product' | null;

export interface CanonicalRenderInput {
  template_id: string;
  template_version_id?: string | null;
  context_type?: CanonicalContextType;
  context_id?: string | null;
  /** Override executor (default: executors.is_default = true) */
  executor_id?: string | null;
  /** Customer legal_details_id; обычно резолвится из заказа */
  legal_details_id?: string | null;
  /** Подписант со стороны customer */
  signer_link_id?: string | null;
  /** Дополнительные ad-hoc значения; имеют наивысший приоритет */
  overrides?: Record<string, string | number | null>;
}

export interface ResolvedPayload {
  resolved_tokens: Record<string, string>;
  missing_tokens: string[];
  unmapped_template_tokens: string[];
  warnings: string[];
  snapshot: Record<string, unknown>;
  template: { id: string; name: string; version_id: string | null; version_number: number | null };
  template_tokens: string[];
}

export interface CanonicalGenerateResult {
  success: boolean;
  payload: ResolvedPayload;
  document_id?: string;
  document_number?: string;
  download_url?: string;
  storage_path?: string;
  reused?: boolean;
  error?: string;
}

// ──────────────────────────── helpers ──────────────────────────────────────

function dateToRussianFormat(date: Date): string {
  const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

function fullNameToInitials(fullName?: string | null): string {
  if (!fullName) return '';
  const parts = String(fullName).trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} ${parts[1][0]}.`;
  return `${parts[0]} ${parts[1][0]}.${parts[2][0]}.`;
}

function buildCustomerName(ld: any): string {
  if (!ld) return '';
  if (ld.client_type === 'individual') return ld.ind_full_name || '';
  if (ld.client_type === 'entrepreneur') return ld.ent_name || '';
  return ld.leg_name || '';
}

function buildCustomerAddress(ld: any): string {
  if (!ld) return '';
  if (ld.client_type === 'individual') {
    return [ld.ind_address_index, ld.ind_address_region, ld.ind_address_district, ld.ind_address_city,
      ld.ind_address_street, ld.ind_address_house, ld.ind_address_apartment && `кв. ${ld.ind_address_apartment}`]
      .filter(Boolean).join(', ');
  }
  if (ld.client_type === 'entrepreneur') return ld.ent_address || '';
  return ld.leg_address || '';
}

function generateDocNumber(prefix = 'AKT'): string {
  const now = new Date();
  const y = now.getFullYear().toString().slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const r = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `${prefix}-${y}${m}${d}-${r}`;
}

function extractTokensFromBuffer(buffer: Uint8Array): string[] {
  try {
    const zip = new PizZip(buffer);
    const tokens = new Set<string>();
    const re = /\{\{\s*([^}]+?)\s*\}\}/g;
    for (const path of ['word/document.xml','word/header1.xml','word/footer1.xml']) {
      const file = zip.file(path);
      if (!file) continue;
      const txt = file.asText();
      let m: RegExpExecArray | null;
      while ((m = re.exec(txt)) !== null) tokens.add(m[1].trim());
    }
    return Array.from(tokens).sort();
  } catch {
    return [];
  }
}

// ──────────────────────────── feature flag ─────────────────────────────────

export async function isCanonicalEnabled(supabase: any): Promise<boolean> {
  const { data } = await supabase.from('app_settings').select('value').eq('key', CANONICAL_FEATURE_FLAG_KEY).maybeSingle();
  return data?.value === true;
}

// ──────────────────────────── resolver ─────────────────────────────────────

export async function resolveCanonicalPayload(
  supabase: any,
  input: CanonicalRenderInput,
): Promise<ResolvedPayload> {
  const warnings: string[] = [];

  // 1. Template + current version
  const { data: tpl } = await supabase
    .from('document_templates')
    .select('id, name, code, template_path, current_version_id')
    .eq('id', input.template_id).maybeSingle();
  if (!tpl) throw new Error('Template not found');

  let version: any = null;
  if (input.template_version_id) {
    const { data } = await supabase.from('document_template_versions').select('*').eq('id', input.template_version_id).maybeSingle();
    version = data;
  } else if (tpl.current_version_id) {
    const { data } = await supabase.from('document_template_versions').select('*').eq('id', tpl.current_version_id).maybeSingle();
    version = data;
  }
  const storageBucket = version?.storage_bucket || 'documents-templates';
  const storagePath = version?.storage_path || tpl.template_path;
  if (!storagePath) throw new Error('Template has no storage path');

  // 2. Detect tokens used in DOCX (from version.tokens or live extract)
  let templateTokens: string[] = Array.isArray(version?.tokens) ? version.tokens : [];
  if (templateTokens.length === 0) {
    const { data: file } = await supabase.storage.from(storageBucket).download(storagePath);
    if (file) {
      const buf = new Uint8Array(await file.arrayBuffer());
      templateTokens = extractTokensFromBuffer(buf);
    }
  }

  // 3. Token registry
  const { data: registryRows } = await supabase.from('document_token_registry').select('*').is('archived_at', null);
  const registryByKey = new Map<string, any>();
  for (const r of (registryRows || [])) registryByKey.set(r.token_key, r);

  // 4. Executor
  let executor: any = null;
  if (input.executor_id) {
    const { data } = await supabase.from('executors').select('*').eq('id', input.executor_id).maybeSingle();
    executor = data;
  } else {
    const { data } = await supabase.from('executors').select('*').eq('is_default', true).eq('is_active', true).maybeSingle();
    executor = data;
  }
  if (!executor) warnings.push('executor_not_found');

  // 5. Order context
  let order: any = null;
  let product: any = null;
  let tariff: any = null;
  if (input.context_type === 'order' && input.context_id) {
    const { data: o } = await supabase
      .from('orders_v2')
      .select('id, order_number, user_id, profile_id, product_id, tariff_id, final_price, base_price, currency, status, created_at, customer_email, customer_phone, meta')
      .eq('id', input.context_id).maybeSingle();
    order = o;
    if (order?.product_id) {
      const { data } = await supabase.from('products_v2').select('id, name, slug').eq('id', order.product_id).maybeSingle();
      product = data;
    }
    if (order?.tariff_id) {
      const { data } = await supabase.from('product_tariffs').select('id, name, access_days').eq('id', order.tariff_id).maybeSingle();
      tariff = data;
    }
  }

  // 6. Customer legal_details
  let customer: any = null;
  if (input.legal_details_id) {
    const { data } = await supabase.from('client_legal_details').select('*').eq('id', input.legal_details_id).maybeSingle();
    customer = data;
  } else if (order?.user_id) {
    const { data: prof } = await supabase.from('profiles').select('id').eq('user_id', order.user_id).maybeSingle();
    if (prof?.id) {
      const { data } = await supabase.from('client_legal_details').select('*').eq('profile_id', prof.id).eq('is_default', true).maybeSingle();
      customer = data;
      if (data) input.legal_details_id = data.id;
    }
  }
  if (!customer) warnings.push('customer_legal_details_not_found');

  // 7. Build resolver values
  const now = new Date();
  const docNumber = generateDocNumber('AKT');
  const resolverValues: Record<string, any> = {
    'system.today':       now.toISOString().slice(0, 10),
    'system.today_long':  dateToRussianFormat(now),
    'document.number':    docNumber,
    'document.date':      dateToRussianFormat(now),
    'document.date_short':now.toLocaleDateString('ru-RU'),

    'executor.name':            executor?.full_name || '',
    'executor.short_name':      executor?.short_name || executor?.full_name || '',
    'executor.unp':             executor?.unp || '',
    'executor.address':         executor?.legal_address || '',
    'executor.bank':            executor?.bank_name || '',
    'executor.bank_code':       executor?.bank_code || '',
    'executor.account':         executor?.bank_account || '',
    'executor.director':        executor?.director_full_name || '',
    'executor.director_short':  executor?.director_short_name || fullNameToInitials(executor?.director_full_name),
    'executor.acts_on_basis':   executor?.acts_on_basis || '',

    'customer.name':            buildCustomerName(customer),
    'customer.short_name':      customer?.client_type === 'individual'
                                  ? fullNameToInitials(customer?.ind_full_name)
                                  : buildCustomerName(customer),
    'customer.unp':             customer?.ent_unp || customer?.leg_unp || '',
    'customer.address':         buildCustomerAddress(customer),
    'customer.phone':           customer?.phone || '',
    'customer.email':           customer?.email || order?.customer_email || '',
    'customer.bank':            customer?.bank_name || '',
    'customer.account':         customer?.bank_account || '',
    'customer.passport':        customer?.ind_passport_series && customer?.ind_passport_number
                                  ? `${customer.ind_passport_series} ${customer.ind_passport_number}` : '',

    'deal.id':            order?.order_number || order?.id || '',
    'deal.product_name':  product?.name || '',
    'deal.tariff_name':   tariff?.name || '',
    'deal.amount':        order?.final_price != null ? String(order.final_price) : '',
    'deal.amount_words':  '', // sprint 2: добавим утилиту
    'deal.currency':      order?.currency || '',
    'deal.paid_at':       order?.created_at ? new Date(order.created_at).toLocaleDateString('ru-RU') : '',
    'deal.access_days':   tariff?.access_days != null ? String(tariff.access_days) : '',
  };

  // 8. legal_details.* (custom_field) — read from customer columns directly via key suffix
  if (customer) {
    for (const [key, row] of registryByKey) {
      if (row.source_type !== 'custom_field' || row.category !== 'legal_details') continue;
      const colName = key.replace(/^legal_details\./, '');
      if (colName in customer) resolverValues[key] = customer[colName] ?? '';
    }
  }

  // 9. Apply overrides
  if (input.overrides) {
    for (const [k, v] of Object.entries(input.overrides)) resolverValues[k] = v ?? '';
  }

  // 10. Build resolved_tokens (only registered keys) + missing
  const resolved: Record<string, string> = {};
  const missing: string[] = [];
  for (const [tokenKey, row] of registryByKey) {
    const v = resolverValues[tokenKey];
    const str = v == null || v === '' ? '' : String(v);
    resolved[tokenKey] = str;
    if (row.is_required && !str) missing.push(tokenKey);
  }

  // 11. Detect template tokens that are NOT in registry
  const unmapped = templateTokens.filter(t => !registryByKey.has(t));
  if (unmapped.length) warnings.push(`unmapped_tokens:${unmapped.length}`);

  // 12. Snapshot
  const snapshot: Record<string, unknown> = {
    generated_at: now.toISOString(),
    resolver_version: CANONICAL_RESOLVER_VERSION,
    template: { id: tpl.id, name: tpl.name, code: tpl.code, version_id: version?.id || null, version_number: version?.version_number || null },
    executor: executor ? { id: executor.id, name: executor.full_name, unp: executor.unp } : null,
    customer: customer ? { id: customer.id, client_type: customer.client_type, name: buildCustomerName(customer), unp: customer.ent_unp || customer.leg_unp } : null,
    order: order ? { id: order.id, order_number: order.order_number, product_id: order.product_id, tariff_id: order.tariff_id, final_price: order.final_price, currency: order.currency, status: order.status } : null,
    document: { number: docNumber, date: now.toISOString() },
  };

  return {
    resolved_tokens: resolved,
    missing_tokens: missing,
    unmapped_template_tokens: unmapped,
    warnings,
    snapshot,
    template: { id: tpl.id, name: tpl.name, version_id: version?.id || null, version_number: version?.version_number || null },
    template_tokens: templateTokens,
  };
}

// ──────────────────────────── render & store ───────────────────────────────

export interface CanonicalGenerateOptions {
  profileId: string;
  userId: string;
  enforceFeatureFlag?: boolean;
  storageBucketOutput?: string;
}

export async function generateCanonicalDocument(
  supabase: any,
  input: CanonicalRenderInput,
  opts: CanonicalGenerateOptions,
): Promise<CanonicalGenerateResult> {
  if (opts.enforceFeatureFlag !== false) {
    const enabled = await isCanonicalEnabled(supabase);
    if (!enabled) return { success: false, payload: null as any, error: 'canonical_generation_disabled' };
  }

  const payload = await resolveCanonicalPayload(supabase, input);

  if (payload.missing_tokens.length > 0) {
    return { success: false, payload, error: `missing_required_tokens:${payload.missing_tokens.join(',')}` };
  }

  // Idempotency
  const idempotencyKey = input.context_type === 'order' && input.context_id
    ? `service_act:${input.context_id}:${payload.template.version_id || payload.template.id}`
    : null;

  if (idempotencyKey) {
    const { data: existing } = await supabase
      .from('ai_generated_documents')
      .select('id, file_path, storage_bucket, status')
      .eq('idempotency_key', idempotencyKey)
      .is('deleted_at', null)
      .maybeSingle();
    if (existing && existing.status === 'success') {
      const { data: signed } = await supabase.storage.from(existing.storage_bucket).createSignedUrl(existing.file_path, 86400);
      return { success: true, payload, document_id: existing.id, download_url: signed?.signedUrl, storage_path: existing.file_path, reused: true };
    }
  }

  // Resolve storage path from version (or fallback to template.template_path)
  let dlBucket = 'documents-templates';
  let dlPath: string | null = null;
  if (payload.template.version_id) {
    const { data: v } = await supabase.from('document_template_versions')
      .select('storage_bucket, storage_path').eq('id', payload.template.version_id).maybeSingle();
    if (v) { dlBucket = v.storage_bucket || dlBucket; dlPath = v.storage_path; }
  }
  if (!dlPath) {
    const { data: t } = await supabase.from('document_templates')
      .select('template_path').eq('id', payload.template.id).maybeSingle();
    dlPath = t?.template_path || null;
  }
  if (!dlPath) return { success: false, payload, error: 'template_storage_path_missing' };
  const { data: file, error: dlErr } = await supabase.storage.from(dlBucket).download(dlPath);
  if (dlErr || !file) return { success: false, payload, error: 'template_file_download_failed' };

  let docBuffer: Uint8Array;
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    const zip = new PizZip(buf);
    const docx = new Docxtemplater(zip, { delimiters: { start: '{{', end: '}}' }, paragraphLoop: true, linebreaks: true });
    // Pass both registered tokens and unmapped (empty for safety)
    const renderData: Record<string, string> = { ...payload.resolved_tokens };
    for (const t of payload.unmapped_template_tokens) if (!(t in renderData)) renderData[t] = '';
    docx.render(renderData);
    docBuffer = docx.getZip().generate({ type: 'uint8array' });
  } catch (e: any) {
    return { success: false, payload, error: `render_failed:${e?.message || 'unknown'}` };
  }

  const docNumber = payload.resolved_tokens['document.number'] || generateDocNumber('AKT');
  const fileName = `${docNumber}.docx`;
  const filePath = `canonical/${opts.profileId}/${fileName}`;
  const outBucket = opts.storageBucketOutput || 'documents';
  const { error: upErr } = await supabase.storage.from(outBucket).upload(filePath, docBuffer, {
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    upsert: true,
  });
  if (upErr) return { success: false, payload, error: `upload_failed:${upErr.message}` };

  const { data: insertRow, error: insErr } = await supabase.from('ai_generated_documents').insert({
    profile_id: opts.profileId,
    template_id: payload.template.id,
    template_name: payload.template.name,
    template_version_id: payload.template.version_id,
    title: `${payload.template.name} — ${docNumber}`,
    status: 'success',
    legal_details_id: input.legal_details_id || null,
    signer_link_id: input.signer_link_id || null,
    file_path: filePath,
    file_name: fileName,
    file_mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    storage_bucket: outBucket,
    snapshot: payload.snapshot,
    missing_tokens: payload.missing_tokens,
    template_tokens_snapshot: payload.template_tokens,
    token_manifest_snapshot: payload.resolved_tokens,
    warnings_snapshot: payload.warnings,
    source_trace: { resolver_version: CANONICAL_RESOLVER_VERSION, idempotency_key: idempotencyKey, context_type: input.context_type, context_id: input.context_id },
    resolver_version: CANONICAL_RESOLVER_VERSION,
    context_type: input.context_type || null,
    context_id: input.context_id || null,
    idempotency_key: idempotencyKey,
    created_by: opts.userId,
    meta: { canonical: true },
  }).select('id').single();

  if (insErr) return { success: false, payload, error: `insert_failed:${insErr.message}` };

  const { data: signed } = await supabase.storage.from(outBucket).createSignedUrl(filePath, 86400);
  return {
    success: true,
    payload,
    document_id: insertRow.id,
    document_number: docNumber,
    download_url: signed?.signedUrl,
    storage_path: filePath,
    reused: false,
  };
}
