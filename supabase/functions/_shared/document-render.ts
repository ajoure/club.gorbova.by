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
import {
  numberToWordsRu,
  formatMoney,
  normalizeCurrency,
  extractDocxTokensWithLocations,
  type TokenManifestEntry,
} from './docx-helpers.ts';
import { ALLOWED_DATE_FORMATS, applyDateFormat } from './dateFormatModifiers.ts';
import { formatStructuredAddress, type FormatAddressResult } from './address-format.ts';
import { applyCaseModifier, isCaseModifier } from './case-format.ts';
import { buildTypedNamespaceValues, applyEntrepreneurNameWithoutQuotes, formatEntrepreneurDisplayName } from './typed-tokens-resolver.ts';

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
  token_manifest: TokenManifestEntry[];
  source_trace: Record<string, { source: string; resolver_key?: string; field_id?: string | null; status: 'resolved' | 'missing' | 'unmapped'; required: boolean }>;
}

export interface CanonicalGenerateResult {
  success: boolean;
  payload: ResolvedPayload;
  document_id?: string;
  document_number?: string;
  download_url?: string;
  storage_path?: string;
  reused?: boolean;
  docx_check?: {
    file_size: number;
    mime: string;
    min_size_ok: boolean;
    unresolved_tokens: string[];
    unresolved_count: number;
    checked_at: string;
    ok: boolean;
  };
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
  if (ld.client_type === 'entrepreneur') return formatEntrepreneurDisplayName(ld.ent_name || '');
  return ld.leg_name || '';
}

// Sprint D — structured address resolution.
// Returns { rendered, source } where source ∈ structured|raw|missing.
function buildCustomerAddressResolved(ld: any): FormatAddressResult {
  if (!ld) return { rendered: '', source: 'missing' };
  if (ld.client_type === 'legal_entity') {
    return formatStructuredAddress(ld.leg_address_structured, ld.leg_address, 'legal_entity');
  }
  if (ld.client_type === 'entrepreneur') {
    return formatStructuredAddress(ld.ent_address_structured, ld.ent_address, 'entrepreneur');
  }
  // individual: prefer structured JSONB, then build from ind_address_* columns,
  // then raw fallback.
  if (ld.ind_address_structured && typeof ld.ind_address_structured === 'object') {
    const r = formatStructuredAddress(ld.ind_address_structured, null, 'individual');
    if (r.rendered) return r;
  }
  const legacyParts = [
    ld.ind_address_street && (/^(ул\.|улица|пр\.|пр-т|проспект|пер\.|переулок)/i.test(ld.ind_address_street)
      ? ld.ind_address_street : `ул. ${ld.ind_address_street}`),
    ld.ind_address_house && `д. ${ld.ind_address_house}`,
    ld.ind_address_apartment && `кв. ${ld.ind_address_apartment}`,
    ld.ind_address_city && (/^г\.?\s/i.test(ld.ind_address_city) ? ld.ind_address_city : `г. ${ld.ind_address_city}`),
    ld.ind_address_index || null,
    ld.ind_address_district || null,
    ld.ind_address_region || null,
  ].filter(Boolean);
  if (legacyParts.length) return { rendered: legacyParts.join(', '), source: 'structured' };
  return { rendered: '', source: 'missing' };
}

function generateDocNumber(prefix = 'AKT'): string {
  const now = new Date();
  const y = now.getFullYear().toString().slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const r = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `${prefix}-${y}${m}${d}-${r}`;
}

function extractTokensFromBuffer(buffer: Uint8Array): { tokens: string[]; manifest: TokenManifestEntry[] } {
  try {
    const r = extractDocxTokensWithLocations(buffer);
    return { tokens: r.tokens, manifest: r.manifest };
  } catch {
    return { tokens: [], manifest: [] };
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

  // 2. Detect tokens used in DOCX (prefer manifest from saved version, else live extract)
  let templateTokens: string[] = Array.isArray(version?.detected_tokens) && version.detected_tokens.length
    ? version.detected_tokens.map((t: any) => typeof t === 'string' ? t : t?.token).filter(Boolean)
    : (Array.isArray(version?.tokens) ? version.tokens : []);
  let tokenManifest: TokenManifestEntry[] = Array.isArray(version?.token_manifest) && version.token_manifest.length
    ? version.token_manifest as TokenManifestEntry[]
    : [];
  if (templateTokens.length === 0 || tokenManifest.length === 0) {
    const { data: file } = await supabase.storage.from(storageBucket).download(storagePath);
    if (file) {
      const buf = new Uint8Array(await file.arrayBuffer());
      const ext = extractTokensFromBuffer(buf);
      if (templateTokens.length === 0) templateTokens = ext.tokens;
      if (tokenManifest.length === 0) tokenManifest = ext.manifest;
    }
  }

  // 3. Token registry
  const { data: registryRows } = await supabase.from('document_token_registry').select('*').is('archived_at', null);
  const registryByKey = new Map<string, any>();
  for (const r of (registryRows || [])) registryByKey.set(r.token_key, r);

  // 3b. Token aliases (global + scoped to this template/version)
  // alias_token (как написано в DOCX) → canonical_token_key (registry)
  const aliasMap = new Map<string, string>();
  const aliasScopes: any[] = [];
  try {
    let q = supabase.from('document_token_aliases')
      .select('alias_token, canonical_token_key, template_id, template_version_id')
      .or(`template_id.is.null,template_id.eq.${tpl.id}`);
    const { data: aliasRows } = await q;
    for (const a of (aliasRows || [])) {
      // version-specific overrides template-specific overrides global
      // we accumulate, then resolve precedence
      aliasScopes.push(a);
    }
    // precedence: version > template > global
    const byAlias = new Map<string, any>();
    for (const a of aliasScopes) {
      const existing = byAlias.get(a.alias_token);
      const score = (a.template_version_id ? 4 : 0) + (a.template_id ? 2 : 0);
      const existingScore = existing ? ((existing.template_version_id ? 4 : 0) + (existing.template_id ? 2 : 0)) : -1;
      if (!existing || score > existingScore) byAlias.set(a.alias_token, a);
    }
    for (const [k, v] of byAlias) {
      // skip version-scoped aliases that don't match current version
      if (v.template_version_id && v.template_version_id !== (version?.id || null)) continue;
      if (registryByKey.has(v.canonical_token_key)) aliasMap.set(k, v.canonical_token_key);
    }
  } catch (_e) { /* aliases table optional */ }

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
  let livePayment: any = null; // Sprint A — last succeeded payments_v2 row for payment.* fallback.
  if (input.context_type === 'order' && input.context_id) {
    const { data: o } = await supabase
      .from('orders_v2')
      .select('id, order_number, user_id, profile_id, product_id, tariff_id, final_price, base_price, currency, status, created_at, customer_email, customer_phone, payer_type, meta')
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
    // Sprint A — read-only fetch последнего succeeded платежа для payment.* live fallback.
    // Snapshot.payment имеет приоритет; live используется только если snapshot отсутствует.
    const { data: pays } = await supabase
      .from('payments_v2')
      .select('id, status, card_last4, card_brand, card_holder, provider, provider_payment_id, amount, currency, meta, paid_at, created_at')
      .eq('order_id', order?.id || input.context_id)
      .order('paid_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(20);
    livePayment = (pays || []).find((p: any) => p.status === 'succeeded') || null;
  }

  // 6. Customer legal_details (Sprint B: payer_type-aware resolution).
  // SOT: orders_v2.payer_type. legal_entity → client_type='legal_entity',
  // individual → client_type='individual'. Within the cohort prefer is_default,
  // then most recently updated. Fallback to ANY default row only when cohort
  // is empty (warning emitted).
  const payerType: 'legal_entity' | 'individual' =
    (order as any)?.payer_type === 'legal_entity' ? 'legal_entity' : 'individual';
  let customer: any = null;
  let customerResolutionSource: string = 'none';
  if (input.legal_details_id) {
    const { data } = await supabase.from('client_legal_details').select('*').eq('id', input.legal_details_id).maybeSingle();
    customer = data;
    customerResolutionSource = 'explicit_legal_details_id';
  } else if (order?.user_id) {
    const { data: prof } = await supabase.from('profiles').select('id').eq('user_id', order.user_id).maybeSingle();
    if (prof?.id) {
      // 1. Try cohort matching payer_type, ordered by is_default DESC, updated_at DESC.
      const { data: cohort } = await supabase
        .from('client_legal_details')
        .select('*')
        .eq('profile_id', prof.id)
        .eq('client_type', payerType)
        .order('is_default', { ascending: false })
        .order('updated_at', { ascending: false })
        .limit(1);
      if (cohort && cohort.length > 0) {
        customer = cohort[0];
        customerResolutionSource = `cohort_${payerType}`;
        input.legal_details_id = customer.id;
      } else {
        // 2. Cohort empty → fallback to any default row, but warn.
        const { data: fallback } = await supabase
          .from('client_legal_details')
          .select('*')
          .eq('profile_id', prof.id)
          .eq('is_default', true)
          .maybeSingle();
        customer = fallback || null;
        if (customer) {
          customerResolutionSource = `fallback_default_${customer.client_type || 'unknown'}`;
          warnings.push(`customer_payer_type_mismatch:expected=${payerType},got=${customer.client_type || 'unknown'}`);
          input.legal_details_id = customer.id;
        }
      }
    }
  }
  if (!customer) {
    warnings.push(payerType === 'legal_entity'
      ? 'customer_legal_entity_requisites_missing'
      : 'customer_legal_details_not_found');
  }

  // 7. Build resolver values
  const now = new Date();
  const docNumber = generateDocNumber('AKT');

  // Sprint D — structured address resolution.
  const executorAddress: FormatAddressResult = executor
    ? formatStructuredAddress(executor.legal_address_structured, executor.legal_address, 'executor')
    : { rendered: '', source: 'missing' };
  const customerAddress: FormatAddressResult = buildCustomerAddressResolved(customer);
  if (executor && executorAddress.source === 'missing') warnings.push('executor_address_missing');
  else if (executor && executorAddress.source === 'raw') warnings.push('executor_address_unstructured_fallback');
  if (customer && customerAddress.source === 'missing') warnings.push('customer_address_missing');
  else if (customer && customerAddress.source === 'raw') warnings.push('customer_address_unstructured_fallback');

  const resolverValues: Record<string, any> = {
    'system.today':       now.toISOString().slice(0, 10),
    'system.today_long':  dateToRussianFormat(now),
    'document.number':    docNumber,
    'document.date':      applyDateFormat(now, 'short').value,
    'document.date_short':applyDateFormat(now, 'short').value,

    'executor.name':            executor?.full_name || '',
    'executor.short_name':      executor?.short_name || executor?.full_name || '',
    'executor.unp':             executor?.unp || '',
    'executor.address':         executorAddress.rendered,
    'executor.address.full':    executorAddress.rendered,
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
    'customer.address':         customerAddress.rendered,
    'customer.address.full':    customerAddress.rendered,
    
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
    'deal.amount_words':  order?.final_price != null ? numberToWordsRu(order.final_price, order?.currency) : '',
    'deal.amount_in_words': order?.final_price != null ? numberToWordsRu(order.final_price, order?.currency) : '',
    'deal.amount_formatted': order?.final_price != null ? formatMoney(order.final_price, order?.currency) : '',
    'deal.currency':      order?.currency ? (normalizeCurrency(order.currency) === 'UNKNOWN' ? order.currency : normalizeCurrency(order.currency)) : '',
    'deal.paid_at':       order?.created_at ? new Date(order.created_at).toLocaleDateString('ru-RU') : '',
    'deal.access_days':   tariff?.access_days != null ? String(tariff.access_days) : '',

    // Sprint A — payment.* defaults (empty strings; overlay below from snapshot or live).
    'payment.method':                  '',
    'payment.method_label':            '',
    'payment.description':             '',
    'payment.card.brand':              '',
    'payment.card.brand_normalized':   '',
    'payment.card.last4':              '',
    'payment.card.holder':             '',
    'payment.paid_at':                 '',
    'payment.amount':                  '',
    'payment.currency':                '',
    'payment.provider_transaction_id': '',
    'payment.external_reference':      '',
  };

  // v3 — typed namespace tokens (148) + executor.signer.* (4)
  // Заполняются ТОЛЬКО для сущностей matching subject_type, прочие = ''.
  // ИП name — без кавычек (formatEntrepreneurDisplayName).
  const typedValues = buildTypedNamespaceValues(customer, executor);
  for (const [k, v] of Object.entries(typedValues)) resolverValues[k] = v;
  applyEntrepreneurNameWithoutQuotes(resolverValues, customer, executor);

  // 7a. Sprint A — payment.* overlay (snapshot SOT → live fallback → empty + warning).
  // Snapshot.payment block содержит method_label/description, выработанные на момент snapshot.
  // Live fallback используется только если snapshot.payment отсутствует.
  let paymentSource: 'snapshot' | 'live' | 'none' = 'none';
  function applyPaymentBlock(p: any) {
    if (!p) return;
    const set = (k: string, v: any) => {
      if (v != null && v !== '') resolverValues[k] = String(v);
    };
    set('payment.method', p.method);
    set('payment.method_label', p.method_label);
    set('payment.description', p.description);
    set('payment.card.brand', p.card_brand);
    set('payment.card.brand_normalized', p.card_brand_normalized);
    set('payment.card.last4', p.card_last4);
    set('payment.card.holder', p.card_holder);
    if (p.paid_at) {
      try { resolverValues['payment.paid_at'] = new Date(p.paid_at).toLocaleDateString('ru-RU'); }
      catch { resolverValues['payment.paid_at'] = String(p.paid_at); }
    }
    if (p.amount != null && p.amount !== '') {
      resolverValues['payment.amount'] = formatMoney(Number(p.amount), p.currency || order?.currency);
    }
    set('payment.currency', p.currency);
    set('payment.provider_transaction_id', p.provider_transaction_id);
    set('payment.external_reference', p.external_reference);
  }
  function buildLivePaymentBlock(row: any): any {
    if (!row) return null;
    const channelLabels: Record<string, string> = {
      card: 'Банковская карта', apple_pay: 'Apple Pay', google_pay: 'Google Pay',
      erip: 'ЕРИП', bank_transfer: 'Банковский перевод',
    };
    const provider = row.provider || null;
    const method = provider === 'bepaid' ? 'card' : (provider || 'unknown');
    const methodLabel = channelLabels[method] || method;
    const brand = row.card_brand || null;
    const brandNorm = brand ? String(brand).toLowerCase().replace(/[^a-z0-9]+/g, '_') : null;
    const last4 = row.card_last4 || null;
    const holder = row.card_holder || null;
    const txnId = row.provider_payment_id || null;
    const meta = row.meta || {};
    const descParts = [methodLabel];
    if (brand) descParts.push(brand);
    if (last4) descParts.push(`**** ${last4}`);
    if (holder) descParts.push(holder);
    return {
      payment_id: row.id, provider, method, method_label: methodLabel,
      description: descParts.filter(Boolean).join(', '),
      card_brand: brand, card_brand_normalized: brandNorm,
      card_last4: last4, card_holder: holder,
      paid_at: row.paid_at || row.created_at,
      amount: row.amount, currency: row.currency,
      provider_transaction_id: txnId,
      external_reference: meta.external_reference || meta.external_ref || null,
    };
  }

  // 7b. Sprint 10 — overlay orders_v2.meta.document_data snapshot.
  // Priority chain: snapshot → input.overrides → live → computed fallback.
  // The snapshot is treated as SOT for reproducibility once it exists.
  const docData: any = (order as any)?.meta?.document_data || null;
  if (input.context_type === 'order' && input.context_id) {
    if (!docData) {
      warnings.push('document_data_snapshot_missing');
      warnings.push('document_data_live_fallback_used');
    } else {
      // Map snapshot fields into deal.* tokens.
      if (docData.amount != null) {
        resolverValues['deal.amount'] = String(docData.amount);
        resolverValues['deal.amount_formatted'] = formatMoney(docData.amount, docData.currency || order?.currency);
      }
      if (docData.amount_words) {
        resolverValues['deal.amount_words'] = docData.amount_words;
        resolverValues['deal.amount_in_words'] = docData.amount_words;
      }
      if (docData.currency) resolverValues['deal.currency'] = docData.currency;
      if (docData.currency_major) resolverValues['deal.currency_major'] = docData.currency_major;
      if (docData.currency_minor) resolverValues['deal.currency_minor'] = docData.currency_minor;
      if (docData.service_name) resolverValues['deal.service_name'] = docData.service_name;
      if (docData.service_description) resolverValues['deal.service_description'] = docData.service_description;
      if (docData.unit) resolverValues['deal.unit'] = docData.unit;
      if (docData.quantity != null) resolverValues['deal.quantity'] = String(docData.quantity);
      if (docData.unit_price != null) resolverValues['deal.unit_price'] = String(docData.unit_price);
      if (docData.payment_due_days != null) resolverValues['deal.payment_due_days'] = String(docData.payment_due_days);
      if (docData.execution_days != null) resolverValues['deal.execution_days'] = String(docData.execution_days);
      if (docData.service_period_from) resolverValues['deal.service_period_from'] = docData.service_period_from;
      if (docData.service_period_to) resolverValues['deal.service_period_to'] = docData.service_period_to;
      if (docData.months_count != null) resolverValues['deal.months_count'] = String(docData.months_count);
      if (docData.prepayment_percent != null) resolverValues['deal.prepayment_percent'] = String(docData.prepayment_percent);
      if (docData.prepayment_amount != null) resolverValues['deal.prepayment_amount'] = String(docData.prepayment_amount);
      if (docData.discount_amount != null) resolverValues['deal.discount_amount'] = String(docData.discount_amount);
      if (docData.first_payment != null) resolverValues['deal.first_payment'] = String(docData.first_payment);
      if (docData.bank_credit_price != null) resolverValues['deal.bank_credit_price'] = String(docData.bank_credit_price);
      if (docData.final_payment != null) resolverValues['deal.final_payment'] = String(docData.final_payment);
      if (docData.comment) resolverValues['deal.comment'] = docData.comment;
    }

    // Sprint A — payment.* overlay (snapshot SOT → live fallback → empty + warning).
    if (docData?.payment) {
      applyPaymentBlock(docData.payment);
      paymentSource = 'snapshot';
    } else if (livePayment) {
      applyPaymentBlock(buildLivePaymentBlock(livePayment));
      paymentSource = 'live';
      warnings.push('payment_snapshot_missing_live_fallback_used');
    } else {
      paymentSource = 'none';
      warnings.push('payment_data_missing');
    }
  }

  // 8. legal_details.* (custom_field) — read from customer columns directly via key suffix
  if (customer) {
    for (const [key, row] of registryByKey) {
      if (row.source_type !== 'custom_field' || row.category !== 'legal_details') continue;
      const colName = key.replace(/^legal_details\./, '');
      if (colName in customer) resolverValues[key] = customer[colName] ?? '';
    }
  }

  // 9. Apply overrides (highest priority — manual ad-hoc inputs)
  if (input.overrides) {
    for (const [k, v] of Object.entries(input.overrides)) resolverValues[k] = v ?? '';
  }

  // 10. Build resolved_tokens (only registered keys) + missing + source_trace
  const resolved: Record<string, string> = {};
  const missing: string[] = [];
  const sourceTrace: ResolvedPayload['source_trace'] = {};

  function sourceFor(row: any): string {
    if (row.source_type === 'custom_field') return `client_legal_details.${row.token_key.replace(/^legal_details\./, '')}`;
    const k: string = row.resolver_key || row.token_key;
    if (k === 'executor.address' || k === 'executor.address.full') {
      return `executors.${executorAddress.source}`;
    }
    if (k === 'customer.address' || k === 'customer.address.full') {
      return `client_legal_details.${customerAddress.source}`;
    }
    if (k.startsWith('executor.')) return 'executors';
    if (k.startsWith('customer.')) return 'client_legal_details / orders_v2';
    if (k.startsWith('deal.')) return 'orders_v2';
    if (k.startsWith('payment.')) {
      // Sprint A — payment.* источник = payments_v2 (snapshot или live).
      return paymentSource === 'snapshot' ? 'payments_v2_snapshot' : (paymentSource === 'live' ? 'payments_v2' : 'payments_v2_missing');
    }
    if (k.startsWith('document.')) return 'system.generated';
    if (k.startsWith('system.')) return 'system';
    return 'resolver';
  }

  for (const [tokenKey, row] of registryByKey) {
    const v = resolverValues[tokenKey];
    const str = v == null || v === '' ? '' : String(v);
    resolved[tokenKey] = str;
    const status: 'resolved' | 'missing' = str ? 'resolved' : 'missing';
    if (row.is_required && !str) missing.push(tokenKey);
    // Only emit source_trace for tokens actually present in template — keeps payload tight.
    if (templateTokens.length === 0 || templateTokens.includes(tokenKey)) {
      sourceTrace[tokenKey] = {
        source: sourceFor(row),
        resolver_key: row.resolver_key || row.token_key,
        field_id: row.field_id || null,
        status,
        required: !!row.is_required,
      };
    }
  }

  // 11. Detect template tokens that are NOT in registry (after alias mapping)
  const unmapped = templateTokens.filter(t => !registryByKey.has(t) && !aliasMap.has(t));
  if (unmapped.length) warnings.push(`unmapped_tokens:${unmapped.length}`);
  for (const t of unmapped) {
    sourceTrace[t] = { source: 'unmapped', status: 'unmapped', required: false };
  }
  // For aliased tokens — emit source_trace pointing to canonical
  for (const [alias, canonical] of aliasMap) {
    if (!templateTokens.includes(alias)) continue;
    sourceTrace[alias] = {
      source: `alias→${canonical}`,
      resolver_key: canonical,
      field_id: registryByKey.get(canonical)?.field_id || null,
      status: resolved[canonical] ? 'resolved' : 'missing',
      required: !!registryByKey.get(canonical)?.is_required,
    };
  }

  // 12. Snapshot
  const snapshot: Record<string, unknown> = {
    generated_at: now.toISOString(),
    resolver_version: CANONICAL_RESOLVER_VERSION,
    template: { id: tpl.id, name: tpl.name, code: tpl.code, version_id: version?.id || null, version_number: version?.version_number || null },
    executor: executor ? {
      id: executor.id, name: executor.full_name, unp: executor.unp,
      address: { rendered: executorAddress.rendered, source: executorAddress.source,
                 structured: executor.legal_address_structured || null, raw: executor.legal_address || null },
    } : null,
    customer: customer ? {
      id: customer.id, client_type: customer.client_type, name: buildCustomerName(customer),
      unp: customer.ent_unp || customer.leg_unp,
      address: { rendered: customerAddress.rendered, source: customerAddress.source,
                 structured: customer.leg_address_structured || customer.ent_address_structured || customer.ind_address_structured || null,
                 raw: customer.leg_address || customer.ent_address || null },
    } : null,
    customer_resolution: { payer_type: payerType, source: customerResolutionSource, client_type: customer?.client_type || null },
    order: order ? { id: order.id, order_number: order.order_number, payer_type: (order as any).payer_type || null, product_id: order.product_id, tariff_id: order.tariff_id, final_price: order.final_price, currency: order.currency, status: order.status } : null,
    document: { number: docNumber, date: now.toISOString() },
    token_manifest: tokenManifest,
    aliases: Object.fromEntries(aliasMap),
    document_data: (order as any)?.meta?.document_data || null,
    document_data_source: (order as any)?.meta?.document_data ? 'order_snapshot' : 'live_fallback',
  };

  return {
    resolved_tokens: resolved,
    missing_tokens: missing,
    unmapped_template_tokens: unmapped,
    warnings,
    snapshot,
    template: { id: tpl.id, name: tpl.name, version_id: version?.id || null, version_number: version?.version_number || null },
    template_tokens: templateTokens,
    token_manifest: tokenManifest,
    source_trace: sourceTrace,
  };
}

// ──────────────────────────── render & store ───────────────────────────────

export interface CanonicalGenerateOptions {
  profileId: string;
  userId: string;
  enforceFeatureFlag?: boolean;
  storageBucketOutput?: string;
  /** Skip idempotency lookup/key — used by manual regeneration to force a new row. */
  bypassIdempotency?: boolean;
  /** Explicit idempotency key override (mutually exclusive with bypassIdempotency). */
  idempotencyKeyOverride?: string | null;
  /**
   * Sprint C — canonical numbering mode.
   * - 'generate' (default): pre-INSERT pending row → call allocate_document_number RPC
   *   → render with canonical number → UPDATE row to success. Расходует sequence ровно на 1.
   * - 'preview': НЕ insert в ai_generated_documents (caller сам решает, что делать),
   *   sequence НЕ расходуется. generateCanonicalDocument при mode='preview' использует
   *   временный номер вида PREVIEW-DDMM. Обычно preview идёт через resolveCanonicalPayload
   *   напрямую — этот режим оставлен для smoke/проверки рендера без расхода номера.
   */
  mode?: 'generate' | 'preview';
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
  const idempotencyKey = opts.bypassIdempotency
    ? (opts.idempotencyKeyOverride ?? null)
    : (opts.idempotencyKeyOverride !== undefined
        ? opts.idempotencyKeyOverride
        : (input.context_type === 'order' && input.context_id
            ? `service_act:${input.context_id}:${payload.template.version_id || payload.template.id}`
            : null));

  if (idempotencyKey && !opts.bypassIdempotency) {
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

  // ─── Sprint C — canonical numbering ───────────────────────────────────────
  // mode='generate' (default): pre-INSERT pending row → allocate_document_number RPC
  //   → use canonical number for render & filename → UPDATE row to success.
  // mode='preview': временный номер PREVIEW-DDMM, sequence НЕ расходуется,
  //   row не инсертится (caller sample/diagnostic).
  const mode: 'generate' | 'preview' = opts.mode || 'generate';
  const _now = new Date();
  const _ddmm = `${String(_now.getDate()).padStart(2, '0')}${String(_now.getMonth() + 1).padStart(2, '0')}`;

  let canonicalDocNumber: string | null = null;
  let canonicalDocDate: string | null = null;
  let pendingDocId: string | null = null;

  if (mode === 'preview') {
    canonicalDocNumber = `PREVIEW-${_ddmm}`;
    canonicalDocDate = _now.toISOString().slice(0, 10);
  } else {
    // pre-INSERT pending row to get id for allocate_document_number RPC
    const { data: pending, error: pendErr } = await supabase.from('ai_generated_documents').insert({
      profile_id: opts.profileId,
      template_id: payload.template.id,
      template_name: payload.template.name,
      template_version_id: payload.template.version_id,
      title: `${payload.template.name} — pending`,
      status: 'pending',
      legal_details_id: input.legal_details_id || null,
      signer_link_id: input.signer_link_id || null,
      storage_bucket: opts.storageBucketOutput || 'documents',
      idempotency_key: idempotencyKey,
      context_type: input.context_type || null,
      context_id: input.context_id || null,
      created_by: opts.userId,
      meta: { canonical: true, numbering_pending: true },
    }).select('id').single();

    if (pendErr) {
      // Race-safe: на UNIQUE-конфликт по idempotency_key — попробовать reuse существующий success-row
      if (idempotencyKey && /duplicate key|unique/i.test(pendErr.message || '')) {
        const { data: existing2 } = await supabase
          .from('ai_generated_documents')
          .select('id, file_path, storage_bucket, status, document_number')
          .eq('idempotency_key', idempotencyKey)
          .is('deleted_at', null)
          .maybeSingle();
        if (existing2 && existing2.status === 'success' && existing2.file_path) {
          const { data: signed } = await supabase.storage.from(existing2.storage_bucket).createSignedUrl(existing2.file_path, 86400);
          return { success: true, payload, document_id: existing2.id, document_number: existing2.document_number || undefined, download_url: signed?.signedUrl, storage_path: existing2.file_path, reused: true } as any;
        }
      }
      return { success: false, payload, error: `pending_insert_failed:${pendErr.message}` };
    }
    pendingDocId = pending.id;

    const { data: alloc, error: allocErr } = await supabase.rpc('allocate_document_number', { p_document_id: pendingDocId });
    if (allocErr || !alloc || !alloc[0]) {
      return { success: false, payload, error: `allocate_number_failed:${allocErr?.message || 'no_data'}` };
    }
    canonicalDocNumber = alloc[0].document_number;
    canonicalDocDate = alloc[0].document_date;
  }

  // Inject canonical number/date back into resolved tokens for render
  if (canonicalDocNumber) {
    payload.resolved_tokens['document.number'] = canonicalDocNumber;
  }
  if (canonicalDocDate) {
    payload.resolved_tokens['document.date'] = applyDateFormat(canonicalDocDate, 'short').value || canonicalDocDate;
    payload.resolved_tokens['document.date_short'] = payload.resolved_tokens['document.date'];
  }


  let docBuffer: Uint8Array;
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    const zip = new PizZip(buf);
    // Custom parser keeps the entire tag (including `|format=…`) as the variable
    // key, so docxtemplater never tries to interpret `|` as a filter pipeline.
    const docx = new Docxtemplater(zip, {
      delimiters: { start: '{{', end: '}}' },
      paragraphLoop: true,
      linebreaks: true,
      parser: (tag: string) => ({
        get: (scope: any) => {
          const key = (tag || '').trim();
          if (scope && Object.prototype.hasOwnProperty.call(scope, key)) return scope[key];
          return '';
        },
      }) as any,
    });
    // Pass both registered tokens and unmapped (empty for safety)
    const renderData: Record<string, string> = { ...payload.resolved_tokens };
    const aliases: Record<string, string> = ((payload as any).aliases ?? (payload.snapshot as any)?.aliases ?? {}) as Record<string, string>;
    for (const [alias, canonical] of Object.entries(aliases)) {
      const v = payload.resolved_tokens[canonical] ?? '';
      if (!(alias in renderData)) renderData[alias] = v;
      // Also expose alias under unbracketed key (e.g. `payer.name`) so that
      // `payer.name|case=...` modifier loop and any token matchers that look
      // up by base key (without `{{...}}`) resolve to the canonical value.
      const stripped = alias.replace(/^\{\{|\}\}$/g, '');
      if (stripped && !(stripped in renderData)) renderData[stripped] = v;
    }
    // ── Date format modifiers (legacy + canonical syntax) ───────────────────
    // For every known date-bearing token, populate {{<key>|format=<name>}}
    // variants in renderData so that `{{document.date|format=short}}`,
    // `{{document.date|format=long_ru}}`, etc. resolve correctly.
    // Also re-bind the legacy alias `{{document.date_short}}` →
    // equivalent of `{{document.date|format=short}}`.
    const DATE_BEARING_KEYS = ['document.date', 'system.today', 'system.tomorrow', 'system.yesterday'];
    for (const baseKey of DATE_BEARING_KEYS) {
      const baseVal = renderData[baseKey];
      if (baseVal == null || baseVal === '') continue;
      for (const fmt of ALLOWED_DATE_FORMATS) {
        const aliasKey = `${baseKey}|format=${fmt}`;
        if (!(aliasKey in renderData)) {
          renderData[aliasKey] = applyDateFormat(baseVal, fmt).value || baseVal;
        }
      }
    }
    // Legacy: {{document.date_short}} ≡ {{document.date|format=short}}
    if (renderData['document.date'] && !renderData['document.date_short']) {
      renderData['document.date_short'] = applyDateFormat(renderData['document.date'], 'short').value
        || renderData['document.date'];
    }
    // ── Case modifiers (|case=...) для текстовых токенов customer/payer/executor ─
    // Сканируем шаблон-токены: для любого, в котором есть |case=..., вычисляем
    // значение через applyCaseModifier и кладём в renderData по полному ключу.
    // Format на текстовых токенах игнорируется с warning format_modifier_ignored_for_text.
    {
      const customerType = ((payload.snapshot as any)?.customer_resolution?.payer_type
        ?? (payload.snapshot as any)?.customer?.client_type
        ?? null) as 'individual' | 'legal_entity' | 'entrepreneur' | null;
      const TEXT_BASES = new Set([
        'customer.name', 'payer.name',
        'executor.name', 'executor.short_name',
        'executor.director', 'executor.director_short',
      ]);
      for (const tok of payload.template_tokens) {
        if (!tok || tok.indexOf('|case=') === -1) continue;
        if (tok in renderData && renderData[tok] !== '') continue;
        const parts = tok.split('|');
        const baseKey = parts[0];
        let caseVal: string | null = null;
        let formatVal: string | null = null;
        for (const p of parts.slice(1)) {
          const eq = p.indexOf('=');
          if (eq < 0) continue;
          const k = p.slice(0, eq);
          const v = p.slice(eq + 1);
          if (k === 'case') caseVal = v;
          else if (k === 'format') formatVal = v;
        }
        if (!caseVal) continue;

        // Alias-aware lookup: snapshot.aliases использует ключи вида `{{payer.name}}`
        // (с фигурными скобками), поэтому при отсутствии прямого ключа пробуем
        // бракетированную форму, чтобы payer.name|case=... корректно склонялось.
        const bracketedAlias = `{{${baseKey}}}`;
        const baseValue = renderData[baseKey]
          ?? renderData[bracketedAlias]
          ?? payload.resolved_tokens[baseKey]
          ?? (aliases[bracketedAlias] ? payload.resolved_tokens[aliases[bracketedAlias]] : undefined)
          ?? '';
        const isTextBase = TEXT_BASES.has(baseKey);
        if (isTextBase && formatVal != null) {
          payload.warnings.push(`format_modifier_ignored_for_text:${baseKey}`);
        }
        if (!isCaseModifier(caseVal)) {
          renderData[tok] = baseValue;
          payload.warnings.push(`case_modifier_unknown:${caseVal}`);
          continue;
        }
        const ctxKey = isTextBase ? baseKey : baseKey; // tokenKey для классификатора
        const r = applyCaseModifier(baseValue, caseVal, { tokenKey: ctxKey, customerType });
        renderData[tok] = r.value;
        if (r.warning) payload.warnings.push(r.warning);
      }
    }

    for (const t of payload.unmapped_template_tokens) if (!(t in renderData)) renderData[t] = '';
    docx.render(renderData);
    docBuffer = docx.getZip().generate({ type: 'uint8array' });
  } catch (e: any) {
    return { success: false, payload, error: `render_failed:${e?.message || 'unknown'}` };
  }

  const docNumber = canonicalDocNumber || payload.resolved_tokens['document.number'] || generateDocNumber('AKT');
  // Sanitize for filename: replace '/' (canonical DDMM/N) with '-'
  const safeDocNumber = docNumber.replace(/[\/\\]/g, '-');
  const fileName = `${safeDocNumber}.docx`;
  const filePath = `canonical/${opts.profileId}/${fileName}`;
  const outBucket = opts.storageBucketOutput || 'documents';

  // ── DOCX post-render check (Sprint 9) ─────────────────────────────────────
  const MIN_DOCX_SIZE = 1024;
  const docxCheck: {
    file_size: number;
    mime: string;
    min_size_ok: boolean;
    unresolved_tokens: string[];
    unresolved_count: number;
    checked_at: string;
    ok: boolean;
  } = {
    file_size: docBuffer.byteLength,
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    min_size_ok: docBuffer.byteLength >= MIN_DOCX_SIZE,
    unresolved_tokens: [],
    unresolved_count: 0,
    checked_at: new Date().toISOString(),
    ok: true,
  };
  try {
    const zipCheck = new PizZip(docBuffer);
    const partsToScan = ['word/document.xml', 'word/header1.xml', 'word/header2.xml', 'word/footer1.xml', 'word/footer2.xml'];
    const found = new Set<string>();
    for (const p of partsToScan) {
      const f = zipCheck.file(p);
      if (!f) continue;
      const xml: string = f.asText();
      const text = xml.replace(/<[^>]+>/g, '');
      const re = /\{\{\s*([^{}]+?)\s*\}\}/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) found.add(m[1].trim());
    }
    docxCheck.unresolved_tokens = Array.from(found).sort();
    docxCheck.unresolved_count = found.size;
  } catch (_e) {
    docxCheck.ok = false;
  }
  docxCheck.ok = docxCheck.ok && docxCheck.min_size_ok && docxCheck.unresolved_count === 0;
  const checkWarnings: string[] = [];
  if (!docxCheck.min_size_ok) checkWarnings.push(`docx_check:file_too_small:${docBuffer.byteLength}`);
  if (docxCheck.unresolved_count > 0) checkWarnings.push(`docx_check:unresolved_tokens:${docxCheck.unresolved_tokens.join(',')}`);

  const { error: upErr } = await supabase.storage.from(outBucket).upload(filePath, docBuffer, {
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    upsert: true,
  });
  if (upErr) return { success: false, payload, error: `upload_failed:${upErr.message}` };

  // Sprint C — generate mode: UPDATE pending row; preview mode: INSERT a fresh non-canonical row.
  let insertRowId: string | null = null;
  if (mode === 'generate' && pendingDocId) {
    const { error: updErr } = await supabase.from('ai_generated_documents').update({
      title: `${payload.template.name} — ${docNumber}`,
      status: 'success',
      file_path: filePath,
      file_name: fileName,
      file_mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      storage_bucket: outBucket,
      snapshot: payload.snapshot,
      missing_tokens: payload.missing_tokens,
      template_tokens_snapshot: { tokens: payload.template_tokens, manifest: payload.token_manifest },
      token_manifest_snapshot: payload.resolved_tokens,
      warnings_snapshot: [...payload.warnings, ...checkWarnings],
      source_trace: {
        resolver_version: CANONICAL_RESOLVER_VERSION,
        idempotency_key: idempotencyKey,
        context_type: input.context_type,
        context_id: input.context_id,
        tokens: payload.source_trace,
      },
      resolver_version: CANONICAL_RESOLVER_VERSION,
      meta: { canonical: true, docx_check: docxCheck, numbering_pending: false },
    }).eq('id', pendingDocId);
    if (updErr) return { success: false, payload, error: `update_failed:${updErr.message}` };
    insertRowId = pendingDocId;
  } else {
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
      template_tokens_snapshot: { tokens: payload.template_tokens, manifest: payload.token_manifest },
      token_manifest_snapshot: payload.resolved_tokens,
      warnings_snapshot: [...payload.warnings, ...checkWarnings],
      source_trace: {
        resolver_version: CANONICAL_RESOLVER_VERSION,
        idempotency_key: null,
        context_type: input.context_type,
        context_id: input.context_id,
        tokens: payload.source_trace,
      },
      resolver_version: CANONICAL_RESOLVER_VERSION,
      context_type: input.context_type || null,
      context_id: input.context_id || null,
      idempotency_key: null,
      created_by: opts.userId,
      meta: { canonical: true, docx_check: docxCheck, preview: true },
    }).select('id').single();
    if (insErr) return { success: false, payload, error: `insert_failed:${insErr.message}` };
    insertRowId = insertRow.id;
  }

  const insertRow = { id: insertRowId! };

  // Audit logs (Sprint 9)
  try {
    await supabase.from('audit_logs').insert([
      {
        action: 'document.generated_docx_checked',
        entity_type: 'ai_generated_document',
        entity_id: insertRow.id,
        meta: {
          file_size: docxCheck.file_size,
          mime: docxCheck.mime,
          unresolved_count: docxCheck.unresolved_count,
          ok: docxCheck.ok,
        },
      },
      ...(docxCheck.unresolved_count > 0 ? [{
        action: 'document.generated_docx_has_unresolved_tokens',
        entity_type: 'ai_generated_document',
        entity_id: insertRow.id,
        meta: { unresolved_tokens: docxCheck.unresolved_tokens },
      }] : []),
    ]);
  } catch (_e) { /* audit best-effort */ }

  const { data: signed } = await supabase.storage.from(outBucket).createSignedUrl(filePath, 86400);
  return {
    success: true,
    payload,
    document_id: insertRow.id,
    document_number: docNumber,
    download_url: signed?.signedUrl,
    storage_path: filePath,
    reused: false,
    docx_check: docxCheck,
  } as any;
}
