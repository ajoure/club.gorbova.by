// ============================================================================
// canonical-document-generate-strict (Sprint 11 C3)
// ----------------------------------------------------------------------------
// Strict ID-first DOCX generator.
//
// Single contract:
//   - Template: document_templates.current_version_id (must be is_current=true,
//     validation_status='valid').
//   - Placeholders in DOCX: ONLY `{{field:FLD-XXXXXX}}`. Anything else → error.
//   - Values: orders_v2.meta.document_data.fields[FLD-XXXXXX].value.
//   - Required check: token_manifest entries with required=true must have
//     non-empty values; otherwise generation is blocked (required_empty).
//
// Modes:
//   - 'preview'  → resolved_tokens, missing[], required_empty[], source_trace.
//   - 'generate' → renders DOCX, uploads to documents bucket,
//                  inserts ai_generated_documents, returns signed URL,
//                  writes audit_logs.document.generated.
//
// Email/Telegram/auto-generation NOT triggered.
// ============================================================================

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2';
import Docxtemplater from 'npm:docxtemplater@3.47.1';
import PizZip from 'npm:pizzip@3.1.6';
import { inflectRu, normalizeMasculinePosition, expandOrgFormToLong, type RuCase } from '../_shared/ru-inflection.ts';
import { formatPersonName, type PersonNameFormat } from '../_shared/typed-tokens-resolver.ts';

// Sprint 3J-Roles: ФИО-форматы доступны для ln и для FIO-полей пакета.
const PERSON_NAME_FORMATS: ReadonlySet<string> = new Set(['full', 'short', 'signature_short']);
// FIO-поля пакета (whitelist по bag_key). Для них strict re-форматирует через
// formatPersonName(entry.raw_full_name, ...). Для остальных полей пакета
// format=short/signature_short → unknown_modifier.
const PERSON_NAME_PACKAGE_BAG_KEYS: ReadonlySet<string> = new Set([
  'package.ul.FLD-000014', // director (full/short)
  'package.fl.FLD-000372', // person full_name
]);
import { loadGotenbergConfig, convertDocxToPdf, GotenbergError } from '../_shared/gotenberg.ts';
import { B97_FLD_TO_TOKEN_KEY, buildTypedB97FieldValues } from '../_shared/typed-fld-mapping.ts';
import { snapshotOrderDocumentData } from '../_shared/document-data-snapshot.ts';
import { resolveDocumentScenario, type PayerType } from '../_shared/document-scenario-resolver.ts';
import { derivePaymentChannel } from '../_shared/document-resolver-v2/payment-channel.ts';
import { formatAmountWithWordsByRublesAndKopecks } from '../_shared/amount-with-words.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const RESOLVER_VERSION = 'strict-1.3.0-c5b';

// ─── Русские числительные / даты «прописью» (C5-A) ─────────────────────────
const RU_UNITS_M = ['','один','два','три','четыре','пять','шесть','семь','восемь','девять'];
const RU_UNITS_F = ['','одна','две','три','четыре','пять','шесть','семь','восемь','девять'];
const RU_TEENS = ['десять','одиннадцать','двенадцать','тринадцать','четырнадцать','пятнадцать','шестнадцать','семнадцать','восемнадцать','девятнадцать'];
const RU_TENS = ['','','двадцать','тридцать','сорок','пятьдесят','шестьдесят','семьдесят','восемьдесят','девяносто'];
const RU_HUNDREDS = ['','сто','двести','триста','четыреста','пятьсот','шестьсот','семьсот','восемьсот','девятьсот'];
const RU_MONTHS_GEN = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];

function ruTriad(n: number, female: boolean): string {
  const out: string[] = [];
  const h = Math.floor(n/100), t = Math.floor((n%100)/10), u = n%10;
  if (h) out.push(RU_HUNDREDS[h]);
  if (t === 1) { out.push(RU_TEENS[u]); }
  else {
    if (t) out.push(RU_TENS[t]);
    if (u) out.push((female ? RU_UNITS_F : RU_UNITS_M)[u]);
  }
  return out.join(' ');
}
function ruPlural(n: number, forms: [string,string,string]): string {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}
function ruIntToWords(num: number, female = false): string {
  if (!Number.isFinite(num)) return '';
  num = Math.trunc(num);
  if (num === 0) return 'ноль';
  const neg = num < 0; num = Math.abs(num);
  const parts: string[] = [];
  const billions = Math.floor(num/1_000_000_000); num %= 1_000_000_000;
  const millions = Math.floor(num/1_000_000); num %= 1_000_000;
  const thousands = Math.floor(num/1000); num %= 1000;
  const rest = num;
  if (billions) parts.push(ruTriad(billions, false), ruPlural(billions, ['миллиард','миллиарда','миллиардов']));
  if (millions) parts.push(ruTriad(millions, false), ruPlural(millions, ['миллион','миллиона','миллионов']));
  if (thousands) parts.push(ruTriad(thousands, true), ruPlural(thousands, ['тысяча','тысячи','тысяч']));
  if (rest) parts.push(ruTriad(rest, female));
  return (neg ? 'минус ' : '') + parts.filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
}
function ruMoneyWords(amount: number, currency = 'BYN'): string {
  if (!Number.isFinite(amount)) return '';
  const sign = amount < 0 ? 'минус ' : '';
  amount = Math.abs(amount);
  const rub = Math.floor(amount);
  const cop = Math.round((amount - rub) * 100);
  const cur = (currency || '').toUpperCase();
  const rubForms: [string,string,string] =
    cur === 'BYN' ? ['белорусский рубль','белорусских рубля','белорусских рублей']
    : cur === 'RUB' ? ['рубль','рубля','рублей']
    : cur === 'USD' ? ['доллар США','доллара США','долларов США']
    : cur === 'EUR' ? ['евро','евро','евро']
    : ['рубль','рубля','рублей'];
  const copForms: [string,string,string] = ['копейка','копейки','копеек'];
  const rubWords = ruIntToWords(rub, false);
  const copStr = String(cop).padStart(2,'0');
  return `${sign}${rubWords} ${ruPlural(rub, rubForms)} ${copStr} ${ruPlural(cop, copForms)}`.trim();
}
function ruOrdinalDay(d: number): string {
  const map: Record<number,string> = {
    1:'первое',2:'второе',3:'третье',4:'четвёртое',5:'пятое',6:'шестое',7:'седьмое',8:'восьмое',
    9:'девятое',10:'десятое',11:'одиннадцатое',12:'двенадцатое',13:'тринадцатое',14:'четырнадцатое',
    15:'пятнадцатое',16:'шестнадцатое',17:'семнадцатое',18:'восемнадцатое',19:'девятнадцатое',
    20:'двадцатое',30:'тридцатое',
  };
  if (map[d]) return map[d];
  if (d > 20 && d < 30) return 'двадцать ' + map[d-20];
  if (d === 31) return 'тридцать первое';
  return String(d);
}
function ruYearGenitive(y: number): string {
  // «две тысячи двадцать пятого года»: основа = ruIntToWords(y) с заменой последнего слова на порядковый-Р.п.
  // Ограничимся типичным случаем (год 4-значный).
  const base = ruIntToWords(y, true).replace(/\s+/g,' ').trim();
  const lastSpace = base.lastIndexOf(' ');
  const head = lastSpace > 0 ? base.slice(0, lastSpace) : '';
  const tail = lastSpace > 0 ? base.slice(lastSpace+1) : base;
  const ordTail: Record<string,string> = {
    'один':'первого','одна':'первого','два':'второго','две':'второго','три':'третьего','четыре':'четвёртого',
    'пять':'пятого','шесть':'шестого','семь':'седьмого','восемь':'восьмого','девять':'девятого',
    'десять':'десятого','одиннадцать':'одиннадцатого','двенадцать':'двенадцатого','тринадцать':'тринадцатого',
    'четырнадцать':'четырнадцатого','пятнадцать':'пятнадцатого','шестнадцать':'шестнадцатого',
    'семнадцать':'семнадцатого','восемнадцать':'восемнадцатого','девятнадцать':'девятнадцатого',
    'двадцать':'двадцатого','тридцать':'тридцатого','сорок':'сорокового','пятьдесят':'пятидесятого',
    'шестьдесят':'шестидесятого','семьдесят':'семидесятого','восемьдесят':'восьмидесятого','девяносто':'девяностого',
    'сто':'сотого','двести':'двухсотого','триста':'трёхсотого','четыреста':'четырёхсотого',
    'пятьсот':'пятисотого','шестьсот':'шестисотого','семьсот':'семисотого','восемьсот':'восьмисотого',
    'девятьсот':'девятисотого',
    'тысяча':'тысячного','тысячи':'тысячного','тысяч':'тысячного',
  };
  const ord = ordTail[tail] || (tail + 'ого');
  return (head ? head + ' ' : '') + ord;
}
function parseDateLoose(s: string): Date | null {
  if (!s) return null;
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2]-1, +m[3]));
  m = t.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/);
  if (m) return new Date(Date.UTC(+m[3], +m[2]-1, +m[1]));
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d;
}
function ruDateWords(s: string): string | null {
  const d = parseDateLoose(s);
  if (!d) return null;
  const day = d.getUTCDate();
  const month = d.getUTCMonth();
  const year = d.getUTCFullYear();
  return `${ruOrdinalDay(day)} ${RU_MONTHS_GEN[month]} ${ruYearGenitive(year)} года`;
}
function parseNumberLoose(v: any): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v !== 'string') return null;
  const cleaned = v.replace(/\s+/g,'').replace(',', '.').replace(/[^0-9.\-]/g,'');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
function applyDateAliasFormat(rawValue: any, format: string): { value: string; applied: boolean } {
  // Reuse the legacy date parser to honor existing tolerant input formats
  const d = parseDateLoose(typeof rawValue === 'string' ? rawValue : String(rawValue ?? ''));
  if (!d) return { value: fmtVal(rawValue), applied: false };
  const day = d.getUTCDate();
  const monthIdx = d.getUTCMonth();
  const year = d.getUTCFullYear();
  const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));
  switch (format) {
    case 'short':
    case 'dd.MM.yyyy':
      return { value: `${pad2(day)}.${pad2(monthIdx + 1)}.${year}`, applied: true };
    case 'long_ru':
      return { value: `${pad2(day)} ${RU_MONTHS_GEN[monthIdx]} ${year} г.`, applied: true };
    case 'words_ru': {
      // Same as legacy `format=words` for date — keeps semantics identical.
      const w = ruDateWords(typeof rawValue === 'string' ? rawValue : String(rawValue ?? ''));
      return w ? { value: w, applied: true } : { value: fmtVal(rawValue), applied: false };
    }
    default:
      return { value: fmtVal(rawValue), applied: false };
  }
}

function applyFormat(rawValue: any, dataType: string, currency: string | null, format: string | null): { value: string; applied: boolean } {
  const baseStr = fmtVal(rawValue);
  if (!format) return { value: baseStr, applied: false };
  if (format === 'text' && dataType === 'boolean') {
    const truthy = rawValue === true || rawValue === 'true' || rawValue === 1 || rawValue === '1' || rawValue === 'yes' || rawValue === 'да';
    return { value: truthy ? 'да' : 'нет', applied: true };
  }
  if (format === 'words') {
    if (dataType === 'money') {
      const n = parseNumberLoose(rawValue);
      if (n === null) return { value: baseStr, applied: false };
      return { value: formatAmountWithWordsByRublesAndKopecks(n, currency || 'BYN'), applied: true };
    }
    if (dataType === 'number') {
      const n = parseNumberLoose(rawValue);
      if (n === null) return { value: baseStr, applied: false };
      return { value: ruIntToWords(n, false), applied: true };
    }
    if (dataType === 'date' || dataType === 'datetime') {
      const w = ruDateWords(baseStr);
      if (!w) return { value: baseStr, applied: false };
      return { value: w, applied: true };
    }
  }
  // Date-only format aliases — only applied when data_type is date/datetime.
  if (format === 'short' || format === 'dd.MM.yyyy' || format === 'long_ru' || format === 'words_ru') {
    if (dataType === 'date' || dataType === 'datetime') {
      return applyDateAliasFormat(rawValue, format);
    }
    return { value: baseStr, applied: false };
  }
  return { value: baseStr, applied: false };
}
const FLD_RE = /^FLD-\d+$/;
const ALLOWED_CASES = new Set([
  'nominative', 'genitive', 'dative', 'accusative', 'instrumental', 'prepositional',
]);
// Allowed `format=...` values:
//   - 'words' / 'text' — legacy (number/money/boolean/date words/text variants)
//   - date format aliases: 'short', 'dd.MM.yyyy', 'long_ru', 'words_ru'
//     (applied only to data_type ∈ {date, datetime}; otherwise warning).
//   - 'long' — раскрывает короткую форму собственности (ООО → Общество с
//     ограниченной ответственностью). Применяется только к токенам
//     `*.leg.org_form`; на других полях возвращает значение без изменений.
const ALLOWED_FORMATS = new Set([
  'words', 'text',
  'short', 'dd.MM.yyyy', 'long_ru', 'words_ru',
  'long',
]);
// Format/case modifier values may include letters, digits, underscore and dot
// (the dot is required for `format=dd.MM.yyyy`).
const STRICT_FIELD_RE = /^field:(FLD-\d+)((?:\|[a-z_]+=[A-Za-z0-9_.]+)*)$/;
// Префикс «правильного контракта» — `field:FLD-…` (с любым хвостом). Если префикс совпал,
// но STRICT_FIELD_RE — нет, классифицируем как `unknown_modifier`, а не как legacy.
const FIELD_PREFIX_RE = /^field:FLD-\d+(\||$)/;
const ANY_TOKEN_RE = /\{\{([^}]+)\}\}/g;
// ── Sprint 3I-A-1.B: package-mode tokens (Variant A — case modifier supported)
const PKG_REQ_RE = /^package\.(ul|ip|fl)\.(FLD-\d+)((?:\|[a-z_]+=[A-Za-z0-9_.]+)*)$/;
const LN_TOKEN_RE = /^(ln-\d+)((?:\|[a-z_]+=[A-Za-z0-9_.]+)*)$/;
// Legacy package-role syntaxes — explicitly forbidden (Sprint 3H-fix canon).
const LEGACY_PKG_ROLE_RE = /^package\.(role\.PKR-|roles\.)/i;

interface ParsedToken {
  raw_inside: string;            // 'field:FLD-1|format=words|case=genitive'
  field_public_id: string;
  format: string | null;         // 'words' | 'text' | null
  case_modifier: string | null;
}

function parseStrictTokenInside(inside: string): ParsedToken | { error: string; raw_inside: string } {
  const m = inside.match(STRICT_FIELD_RE);
  if (!m) {
    // `field:FLD-…|upper` — правильный префикс, неправильные модификаторы → unknown_modifier.
    if (FIELD_PREFIX_RE.test(inside)) return { error: 'unknown_modifier', raw_inside: inside };
    return { error: 'legacy_or_invalid', raw_inside: inside };
  }
  const fld = m[1];
  let format: string | null = null;
  let cs: string | null = null;
  const tail = (m[2] || '').split('|').filter(Boolean);
  for (const part of tail) {
    const [k, v] = part.split('=');
    if (k === 'format') {
      if (!ALLOWED_FORMATS.has(v)) return { error: 'unknown_modifier', raw_inside: inside };
      format = v;
    } else if (k === 'case') {
      if (!ALLOWED_CASES.has(v)) return { error: 'unknown_modifier', raw_inside: inside };
      cs = v;
    } else {
      return { error: 'unknown_modifier', raw_inside: inside };
    }
  }
  return { raw_inside: inside, field_public_id: fld, format, case_modifier: cs };
}

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function extractDocumentXmlText(zip: PizZip): string {
  const file = zip.file('word/document.xml');
  if (!file) return '';
  return file.asText();
}

function stripXml(xml: string): string {
  return xml.replace(/<[^>]+>/g, '');
}

function fmtVal(v: any): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try { return JSON.stringify(v); } catch { return ''; }
}

const TEXT_DT = new Set(['string', 'text', 'email', 'phone']);
const NUM_DT = new Set(['number', 'money', 'date', 'datetime']);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    // ── Sprint 3I-A-1: single unified pipeline (order + package_session) ──
    // Body is parsed ONCE. `packageContext` opts into package-mode value
    // preparation; there is NO second renderer/PDF/persist below — both
    // modes converge on the same Docxtemplater / convertDocxToPdf /
    // storage.upload / ai_generated_documents calls further down.
    const body = await req.json().catch(() => ({}));
    const mode: 'preview' | 'generate' = body?.mode === 'generate' ? 'generate' : 'preview';
    const rawPackageCtx = body?.packageContext && typeof body.packageContext === 'object'
      ? body.packageContext : null;
    const generationContext: 'order' | 'package_session' = rawPackageCtx ? 'package_session' : 'order';

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    let userId: string | null = null;
    let isAdmin = false;
    let prof: { id: string } | null = null;
    let orderId: string | null = body?.order_id || null;
    let templateId: string | null = body?.template_id || null;
    const adminForce: boolean = body?.admin_force === true;
    type PackageCtx = {
      template_id: string;
      package_session_id: string;
      package_template_id: string;
      package_template_item_id: string;
      generation_batch_id: string;
      profile_id: string;
      title_override?: string | null;
      preresolved_fields: Record<string, { value: string; source: string }>;
      preresolved_package_fields: Record<string, { value: string; source: string; catalog_tech_key?: string }>;
      preresolved_ln_tokens: Record<string, { value: string; role_catalog_id: string; person_id: string }>;
    };
    let packageContext: PackageCtx | null = null;

    if (generationContext === 'package_session') {
      // Strict service-role guard. Orchestrator MUST send all three signals.
      const internalMarker = req.headers.get('x-internal-call');
      const apikeyHeader = req.headers.get('apikey') || '';
      const authHeader = req.headers.get('Authorization') || '';
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
      if (
        internalMarker !== 'package-orchestrator' ||
        !serviceKey ||
        apikeyHeader !== serviceKey ||
        authHeader !== `Bearer ${serviceKey}`
      ) {
        return json({ error: 'package_context_forbidden' }, 403);
      }
      const requiredKeys: Array<keyof PackageCtx> = [
        'template_id', 'package_session_id', 'package_template_id',
        'package_template_item_id', 'generation_batch_id', 'profile_id',
      ];
      for (const k of requiredKeys) {
        const v = (rawPackageCtx as any)?.[k];
        if (typeof v !== 'string' || !v) return json({ error: `package_context_invalid:${k}` }, 400);
      }
      packageContext = {
        ...(rawPackageCtx as any),
        preresolved_fields: (rawPackageCtx as any).preresolved_fields ?? {},
        preresolved_package_fields: (rawPackageCtx as any).preresolved_package_fields ?? {},
        preresolved_ln_tokens: (rawPackageCtx as any).preresolved_ln_tokens ?? {},
      } as PackageCtx;
      // Package-mode: orchestrator is the trust anchor for profile_id /
      // ownership. Strict acts as system actor — no user JWT.
      prof = { id: packageContext.profile_id };
      templateId = packageContext.template_id;
      orderId = null;
    } else {
      const auth = req.headers.get('Authorization');
      if (!auth?.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401);
      const { data: ud } = await supabase.auth.getUser(auth.slice(7));
      if (!ud?.user) return json({ error: 'unauthorized' }, 401);
      userId = ud.user.id;

      const { data: roleRows } = await supabase
        .from('user_roles_v2')
        .select('roles!inner(code)')
        .eq('user_id', userId);
      const codes = (roleRows || []).map((r: any) => r.roles?.code);
      isAdmin = codes.includes('admin') || codes.includes('super_admin') || codes.includes('owner');

      const { data: profRow } = await supabase.from('profiles').select('id').eq('user_id', userId).maybeSingle();
      if (!profRow) return json({ error: 'profile_not_found' }, 400);
      prof = profRow;

      if (!orderId) return json({ error: 'order_id_required' }, 400);
    }

    // ── Order-mode preflight + snapshot + B97 fallback ───────────────────
    // Package-mode skips this block entirely: orchestrator already
    // pre-resolved every value into packageContext.
    let order: any;
    let docFields: Record<string, any>;
    let b97FallbackApplied = 0;
    let b97FallbackNonEmpty = 0;
    let b97LiveCustomer: any = null;
    let b97LiveExecutor: any = null;

    if (generationContext === 'order') {
    // ── PATCH-A: load order для общих проверок (hard-stop guards) ─────────
    const { data: ordRow } = await supabase
      .from('orders_v2')
      .select('id, profile_id, status, tariff_id, offer_id, payer_type, meta')
      .eq('id', orderId)
      .maybeSingle();
    if (!ordRow) return json({ error: 'order_not_found' }, 404);

    // Authorization: admin OR self-service (owner of order).
    if (!isAdmin) {
      if (ordRow.profile_id !== prof.id) return json({ error: 'forbidden' }, 403);
    }

    // ── PATCH-A guards (применяются всегда; для admin при admin_force=true
    //    провалившиеся guards только пишут warning и идут дальше) ──────────
    const { hasRealSucceededPayment, getOrderOfferId, isOfferDocumentEnabled } =
      await import('../_shared/purchase-document-rules.ts');

    // PATCH 2026-05-22: добавлены meta, card_last4, card_brand — без них
    // derivePaymentChannel падает в 'other' для bePaid (где payment_method
    // не записывается в meta, а канал определяется по card_last4),
    // и сценарий individual+card не матчится → no_template для клиента.
    const { data: paymentsForOrder } = await supabase
      .from('payments_v2')
      .select('id, status, provider, receipt_url, provider_response, created_at, meta, card_last4, card_brand')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false });
    const paymentsArr = (paymentsForOrder || []) as any[];

    const guardWarnings: string[] = [];
    const guardSkipped: string[] = [];

    // Guard 1: real succeeded payment
    const hasPayment = hasRealSucceededPayment(paymentsArr);
    if (!hasPayment) {
      if (!(isAdmin && adminForce)) {
        await supabase.from('audit_logs').insert({
          actor_user_id: userId, actor_type: isAdmin ? 'admin' : 'user',
          action: 'document.generate_blocked_no_payment',
          meta: { order_id: orderId },
        });
        return json({ error: 'no_real_payment' }, 403);
      }
      guardSkipped.push('no_real_payment');
    }

    // Guard 2/3: offer resolution + document enabled (только для self-service ветки)
    if (!templateId) {
      const offerIdInOrder = getOrderOfferId(ordRow as any);
      let resolvedOfferMeta: any = null;
      let offerSource: 'order_offer' | 'single_active_tariff_offer' | 'none' = 'none';
      let offerReason: string = 'no_offer_id_no_tariff_id';

      if (offerIdInOrder) {
        const { data: off } = await supabase
          .from('tariff_offers').select('id, tariff_id, is_active, meta')
          .eq('id', offerIdInOrder).maybeSingle();
        if (off) { resolvedOfferMeta = off.meta; offerSource = 'order_offer'; offerReason = 'ok'; }
        else { offerReason = 'offer_not_found'; }
      } else if (ordRow.tariff_id) {
        const { data: offs } = await supabase
          .from('tariff_offers').select('id, tariff_id, is_active, meta')
          .eq('tariff_id', ordRow.tariff_id).eq('is_active', true);
        if ((offs || []).length === 1) {
          resolvedOfferMeta = offs![0].meta;
          offerSource = 'single_active_tariff_offer';
          offerReason = 'ok';
        } else {
          offerReason = 'multiple_or_zero_active_offers';
        }
      }

      if (offerSource === 'none') {
        if (!(isAdmin && adminForce)) {
          await supabase.from('audit_logs').insert({
            actor_user_id: userId, actor_type: isAdmin ? 'admin' : 'user',
            action: 'document.generate_blocked_offer_unresolved',
            meta: { order_id: orderId, reason: offerReason },
          });
          return json({ error: 'offer_unresolved', reason: offerReason }, 409);
        }
        guardSkipped.push(`offer_unresolved:${offerReason}`);
      }

      // Channel + payer type
      const succeededPayment = paymentsArr.find((p: any) => String(p.status).toLowerCase() === 'succeeded');
      const channel = derivePaymentChannel(succeededPayment as any);
      const payerType = ((ordRow as any).payer_type as PayerType) || 'individual';
      const docStatus = isOfferDocumentEnabled(resolvedOfferMeta, { payerType, paymentChannel: channel });

      if (docStatus.enabled) {
        templateId = docStatus.template_id;
      } else {
        if (!(isAdmin && adminForce)) {
          const code = docStatus.reason === 'no_template'
            ? 'document_template_not_configured'
            : 'document_not_enabled_for_offer';
          const status = docStatus.reason === 'no_template' ? 409 : 403;
          await supabase.from('audit_logs').insert({
            actor_user_id: userId, actor_type: isAdmin ? 'admin' : 'user',
            action: `document.generate_blocked_${code}`,
            meta: { order_id: orderId, offer_source: offerSource, reason: docStatus.reason },
          });
          return json({ error: code, reason: docStatus.reason }, status);
        }
        guardSkipped.push(`doc_disabled:${docStatus.reason}`);
      }

      // Fallback (admin_force): reuse last template_id of order from legacy/canonical docs.
      if (!templateId) {
        const { data: lastDoc } = await supabase
          .from('ai_generated_documents').select('template_id')
          .eq('context_type', 'order').eq('context_id', orderId)
          .not('template_id', 'is', null)
          .order('created_at', { ascending: false }).limit(1).maybeSingle();
        templateId = (lastDoc?.template_id as string) || null;
      }
      if (!templateId) {
        return json({
          error: 'template_id_required',
          hint: 'Для этого тарифа не настроен шаблон документа. Обратитесь к администратору.',
        }, 400);
      }
      guardWarnings.push(`admin_force_template_fallback_used`);
    }

    if (isAdmin && adminForce && guardSkipped.length > 0) {
      await supabase.from('audit_logs').insert({
        actor_user_id: userId, actor_type: 'admin',
        action: 'document.admin_force_generate',
        meta: { order_id: orderId, template_id: templateId, skipped_guards: guardSkipped, warnings: guardWarnings },
      });
    }
    } // end of generationContext === 'order' (guards block)

    // ── Sprint 3I-A-1.B: package-mode now flows through the unified
    // render/PDF/persist pipeline below. NO short-circuit, NO second renderer.


    // Load template + active version — common to order and package modes.
    const { data: tpl } = await supabase
      .from('document_templates')
      .select('id, name, current_version_id, is_active, template_status')
      .eq('id', templateId)
      .maybeSingle();
    if (!tpl) return json({ error: 'template_not_found', template_id: templateId, hint: 'Шаблон не существует или был удалён. Очистите ручной выбор и пересохраните карточку «Документы / плательщик».' }, 404);
    if (tpl.is_active === false || tpl.template_status === 'archived' || tpl.template_status === 'deleted') {
      return json({ error: 'template_inactive', template_id: templateId, template_status: tpl.template_status, hint: 'Шаблон деактивирован. Выберите актуальный шаблон в карточке сделки.' }, 400);
    }
    if (!tpl.current_version_id) return json({ error: 'no_active_version', template_id: templateId, hint: 'У шаблона нет активной версии. Загрузите DOCX заново.' }, 400);

    const { data: ver } = await supabase
      .from('document_template_versions')
      .select('id, version_number, storage_bucket, storage_path, validation_status, token_manifest, is_current')
      .eq('id', tpl.current_version_id)
      .maybeSingle();
    if (!ver) return json({ error: 'active_version_missing', template_id: templateId, current_version_id: tpl.current_version_id }, 500);
    if (ver.is_current === false) {
      return json({ error: 'version_not_current', template_id: templateId, hint: 'У шаблона рассинхрон версий — current_version_id указывает на устаревшую версию. Активируйте новую версию.' }, 400);
    }
    if (ver.validation_status !== 'valid') {
      return json({ error: 'active_version_invalid', validation_status: ver.validation_status }, 400);
    }

    // Load order + snapshot — order-mode only; package-mode uses stub `order`.
    if (generationContext === 'order') {
      const { data: ordLoaded } = await supabase
        .from('orders_v2')
        .select('id, order_number, profile_id, user_id, payer_type, meta, final_price, currency, status')
        .eq('id', orderId)
        .maybeSingle();
      if (!ordLoaded) return json({ error: 'order_not_found' }, 404);
      order = ordLoaded;

      // ── PATCH-DOC-PLACEHOLDERS-2026-05 F5 ──────────────────────────────────
      // Backend-guaranteed rebuild of document_data snapshot before resolving
      // FLDs. Frontend may also call rebuild as optimization, but the SOT is
      // here: any change to payer_type, payment, customer card, template/executor
      // override, scenario must reflect in the generated document.
      // mergeStandardIntoFields/mergeTypedB97IntoFields preserve manual_override.
      if (order.status === 'paid') {
        const rebuild = await snapshotOrderDocumentData(supabase, orderId, { mode: 'rebuild' });
        if (rebuild.status === 'rebuilt' || rebuild.status === 'created') {
          const { data: reloaded } = await supabase
            .from('orders_v2')
            .select('id, order_number, profile_id, user_id, payer_type, meta, final_price, currency, status')
            .eq('id', orderId)
            .maybeSingle();
          if (reloaded) order = reloaded;
        }
      }

      docFields = (((order.meta as any)?.document_data?.fields) || {}) as Record<string, any>;

      // B-97 live overlay: snapshot may pre-date the typed-FLD writer. Strict
      // generator должен подставлять typed customer/executor значения для FLD из
      // B97 mapping, если snapshot их не содержит (или пуст). Идемпотентно:
      // никогда не перезаписывает manual_override и не трогает legacy FLDs вне
      // B-97 scope. Поднимает audit-warning `b97_live_fallback_used`.
      const docDataMeta: any = (order.meta as any)?.document_data || {};
      const customerLdId = docDataMeta?._provenance?.customer_legal_details_id || null;
      const executorIdSnap = docDataMeta?.executor_id || null;
      if (customerLdId) {
        const { data: ld } = await supabase
          .from('client_legal_details')
          .select('*')
          .eq('id', customerLdId)
          .maybeSingle();
        b97LiveCustomer = ld || null;
      }
      if (!b97LiveCustomer && order.profile_id) {
        const payerType = (order as any).payer_type;
        const wantedClientType = payerType === 'legal_entity' ? 'legal_entity'
          : payerType === 'entrepreneur' ? 'entrepreneur'
          : 'individual';
        const { data: lds } = await supabase
          .from('client_legal_details')
          .select('*')
          .eq('profile_id', order.profile_id)
          .eq('client_type', wantedClientType)
          .order('is_default', { ascending: false })
          .order('updated_at', { ascending: false })
          .limit(1);
        b97LiveCustomer = (lds && lds[0]) || null;
      }
      if (executorIdSnap) {
        const { data: ex } = await supabase.from('executors').select('*').eq('id', executorIdSnap).maybeSingle();
        b97LiveExecutor = ex || null;
      }
      const b97Values = buildTypedB97FieldValues(b97LiveCustomer, b97LiveExecutor);
      const nowIsoB97 = new Date().toISOString();
      for (const [fid] of Object.entries(B97_FLD_TO_TOKEN_KEY)) {
        const existing = docFields[fid];
        if (existing && existing.manual_override === true) continue;
        const existingValue = existing?.value;
        if (existingValue && String(existingValue).length > 0) continue;
        const liveVal = b97Values[fid] ?? '';
        docFields[fid] = {
          value: liveVal,
          source: 'b97_live_fallback',
          manual_override: false,
          updated_at: nowIsoB97,
        };
        b97FallbackApplied += 1;
        if (liveVal.length > 0) b97FallbackNonEmpty += 1;
      }
    } else {
      // Package-mode stub: `order` is purely a carrier for shared downstream
      // code (profile_id, id, currency). docFields is built from packageContext
      // preresolved bags during value resolution below.
      order = {
        id: packageContext!.package_session_id,
        order_number: null,
        profile_id: packageContext!.profile_id,
        user_id: null,
        payer_type: null,
        meta: {},
        final_price: null,
        currency: null,
        status: 'paid',
      };
      // Pre-fill docFields from packageContext.preresolved_fields so the
      // existing field:FLD-* resolver picks values up without modification.
      // Keys in preresolved_fields are bare 'FLD-XXXXXX' (matches docFields).
      docFields = {};
      const _nowPkg = new Date().toISOString();
      for (const [fid, entry] of Object.entries(packageContext!.preresolved_fields || {})) {
        if (!entry) continue;
        docFields[fid] = {
          value: (entry as any).value,
          source: (entry as any).source || 'package_preresolved',
          updated_at: _nowPkg,
        };
      }
    }

    // C5-G: канонические FLD для номера и даты документа
    const FLD_DOC_NUMBER = 'FLD-000069';  // document.number
    const FLD_DOC_DATE   = 'FLD-000070';  // document.date

    // Download DOCX from storage
    const dl = await supabase.storage.from(ver.storage_bucket).download(ver.storage_path);
    if (dl.error) return json({ error: `download_failed:${dl.error.message}` }, 500);
    const buf = await dl.data.arrayBuffer();

    // Parse tokens — допустимы:
    //   field:FLD-XXXXXX[|format=...][|case=...]                — order + package
    //   package.(ul|ip|fl).FLD-XXXXXX[|case=...]                 — package only
    //   ln-XXXXXX[|case=...]                                     — package only
    const zip = new PizZip(buf);
    const rawXml = extractDocumentXmlText(zip);
    const flat = stripXml(rawXml);
    const foundIds = new Set<string>();
    const legacyTokens: string[] = [];
    const unknownModifierTokens: string[] = [];
    const parsedTokens: ParsedToken[] = [];
    // Sprint 3I-A-1.B: package/ln tokens collected here (package_session only).
    interface ParsedPkgToken {
      raw_inside: string;
      kind: 'package' | 'ln';
      bag_key: string;
      case_modifier: string | null;
      format: string | null;
    }
    const parsedPackageTokens: ParsedPkgToken[] = [];
    const packageTokensOutsideContext: string[] = [];
    for (const m of flat.matchAll(ANY_TOKEN_RE)) {
      const inside = m[1].trim();

      // 1) Legacy package-role syntaxes ({{package.role.PKR-…}}, {{package.roles.<key>.*}})
      //    are forbidden everywhere — canonical роль теперь {{ln-XXXXXX}}.
      if (LEGACY_PKG_ROLE_RE.test(inside)) {
        legacyTokens.push(`{{${inside}}}`);
        continue;
      }

      // 2) Package requisite token {{package.(ul|ip|fl).FLD-XXX[|case=…][|format=long]}}
      const pkgMatch = inside.match(PKG_REQ_RE);
      if (pkgMatch) {
        if (generationContext !== 'package_session') {
          packageTokensOutsideContext.push(`{{${inside}}}`);
          continue;
        }
        const tail = (pkgMatch[3] || '').split('|').filter(Boolean);
        let cs: string | null = null;
        let fmt: string | null = null;
        let badMod = false;
        for (const part of tail) {
          const [k, v] = part.split('=');
          if (k === 'case' && ALLOWED_CASES.has(v)) cs = v;
          else if (k === 'format' && (v === 'long' || v === 'words')) fmt = v;
          else { unknownModifierTokens.push(`{{${inside}}}`); badMod = true; break; }
        }
        if (badMod) continue;
        parsedPackageTokens.push({
          raw_inside: inside,
          kind: 'package',
          bag_key: `package.${pkgMatch[1]}.${pkgMatch[2]}`,
          case_modifier: cs,
          format: fmt,
        });
        continue;
      }

      // 3) Role token {{ln-XXXXXX[|case=…]}}
      const lnMatch = inside.match(LN_TOKEN_RE);
      if (lnMatch) {
        if (generationContext !== 'package_session') {
          packageTokensOutsideContext.push(`{{${inside}}}`);
          continue;
        }
        const tail = (lnMatch[2] || '').split('|').filter(Boolean);
        let cs: string | null = null;
        let badMod = false;
        for (const part of tail) {
          const [k, v] = part.split('=');
          if (k === 'case' && ALLOWED_CASES.has(v)) cs = v;
          else { unknownModifierTokens.push(`{{${inside}}}`); badMod = true; break; }
        }
        if (badMod) continue;
        parsedPackageTokens.push({
          raw_inside: inside,
          kind: 'ln',
          bag_key: lnMatch[1],
          case_modifier: cs,
          format: null,
        });
        continue;
      }

      // 4) Legacy billing-style namespaces forbidden in BOTH modes.
      if (/^(document|executor|customer|deal|cf)\./i.test(inside)) {
        legacyTokens.push(`{{${inside}}}`);
        continue;
      }

      // 5) Strict field:FLD-XXX parser (with format/case).
      const p = parseStrictTokenInside(inside);
      if ('error' in p) {
        if (p.error === 'unknown_modifier') unknownModifierTokens.push(`{{${inside}}}`);
        else legacyTokens.push(`{{${inside}}}`);
        continue;
      }
      foundIds.add(p.field_public_id);
      parsedTokens.push(p);
    }

    if (legacyTokens.length > 0) {
      return json({
        error: 'legacy_placeholders_in_active_version',
        code: 'legacy_placeholder_format_detected',
        legacy_tokens: Array.from(new Set(legacyTokens)),
      }, 400);
    }
    if (unknownModifierTokens.length > 0) {
      return json({
        error: 'unknown_modifier_in_active_version',
        code: 'unknown_modifier',
        unknown_modifier_tokens: Array.from(new Set(unknownModifierTokens)),
      }, 400);
    }
    if (packageTokensOutsideContext.length > 0) {
      // package.* or ln-* used in an order-mode template — never silent.
      return json({
        error: 'package_token_outside_package_context',
        tokens: Array.from(new Set(packageTokensOutsideContext)),
      }, 400);
    }

    // Sprint 3I-A-1.B: hard-fail if package/ln token has no preresolved value.
    // Sprint 3I-A-1.B: hard-fail if field:FLD-* in package-mode is not
    // preresolved and is not a system-allocated FLD (000069/000070).
    if (generationContext === 'package_session') {
      const missingPkg: string[] = [];
      for (const pt of parsedPackageTokens) {
        const bag = pt.kind === 'ln'
          ? packageContext!.preresolved_ln_tokens
          : packageContext!.preresolved_package_fields;
        if (!bag || !Object.prototype.hasOwnProperty.call(bag, pt.bag_key)) {
          missingPkg.push(`{{${pt.raw_inside}}}`);
        }
      }
      if (missingPkg.length > 0) {
        return json({
          error: 'package_token_not_preresolved',
          tokens: Array.from(new Set(missingPkg)),
        }, 400);
      }
      const _systemFlds = new Set<string>(['FLD-000069', 'FLD-000070']);
      const preresolvedKeys = new Set<string>(
        Object.keys(packageContext!.preresolved_fields || {}),
      );
      const missingFld: string[] = [];
      for (const fid of foundIds) {
        if (_systemFlds.has(fid)) continue;
        if (!preresolvedKeys.has(fid)) missingFld.push(fid);
      }
      if (missingFld.length > 0) {
        return json({
          error: 'package_field_not_preresolved',
          fields: missingFld,
        }, 400);
      }
    }



    // Required map from token_manifest (если задано)
    const manifest = (Array.isArray(ver.token_manifest) ? ver.token_manifest : []) as any[];
    const requiredIds = new Set<string>(
      manifest
        .filter((m: any) => m?.required === true && typeof m?.field_public_id === 'string')
        .map((m: any) => m.field_public_id),
    );


    // ── PATCH-B FIX: подгрузить file_name_template ДО numbering, чтобы FLD,
    // использованные только в шаблоне имени файла, тоже триггерили аллокацию
    // номера/даты и попадали в общий резолв.
    const { extractFilenamePlaceholders, FLD_PLACEHOLDER_RE: FN_FLD_RE, renderFileName, buildDefaultFileName } =
      await import('../_shared/document-filename.ts');
    const { data: tplExtra } = await supabase
      .from('document_templates')
      .select('file_name_template')
      .eq('id', tpl.id)
      .maybeSingle();
    const fileNameTemplate: string | null = (tplExtra?.file_name_template as string) || null;
    const filenameFlds: string[] = [];
    if (fileNameTemplate) {
      for (const raw of extractFilenamePlaceholders(fileNameTemplate)) {
        const m = raw.match(FN_FLD_RE);
        if (m) {
          const fld = m[1];
          if (!filenameFlds.includes(fld)) filenameFlds.push(fld);
          foundIds.add(fld);
        }
        // невалидные плейсхолдеры остаются warning внутри renderFileName ниже
      }
    }

    // ── C5-G: Document numbering v2 ─────────────────────────────────────────
    // Резервируем номер ОДИН раз на документ (mode=generate), до резолва.
    // Все вхождения {{field:FLD-000069}} получат одно значение из docFields.
    const needsNumbering = foundIds.has(FLD_DOC_NUMBER) || foundIds.has(FLD_DOC_DATE);

    const idempotencyKey: string = generationContext === 'package_session'
      ? `pkg:${packageContext!.generation_batch_id}:${packageContext!.package_template_item_id}`
      : ((typeof body?.idempotency_key === 'string' && body.idempotency_key.trim())
          ? String(body.idempotency_key).trim()
          : `strict:${tpl.id}:${ver.id}:${order.id}`);
    // Sprint 3I-A-1.B: shared context fields used by pre-create, persist, audit.
    const ctxType: 'order' | 'package_session' =
      generationContext === 'package_session' ? 'package_session' : 'order';
    const ctxId: string = generationContext === 'package_session'
      ? packageContext!.package_session_id
      : order.id;
    const docTitle: string = generationContext === 'package_session'
      ? (packageContext!.title_override || tpl.name)
      : `${tpl.name} — ${order.order_number || order.id.slice(0, 8)}`;
    const packageMetaExtras: Record<string, unknown> = generationContext === 'package_session'
      ? {
          package_template_id: packageContext!.package_template_id,
          package_item_id: packageContext!.package_template_item_id,
          generation_batch_id: packageContext!.generation_batch_id,
          actor_type: 'system',
          source: 'package_orchestrator',
        }
      : {};
    const auditContext: Record<string, unknown> = generationContext === 'package_session'
      ? {
          package_session_id: packageContext!.package_session_id,
          package_template_id: packageContext!.package_template_id,
          package_item_id: packageContext!.package_template_item_id,
          generation_batch_id: packageContext!.generation_batch_id,
        }
      : { order_id: order.id };
    const auditActorType: string = generationContext === 'package_session' ? 'system' : 'user';

    let preCreatedDocId: string | null = null;
    let allocatedNumber: string | null = null;
    let allocatedDate: string | null = null;
    let allocatedSeq: number | null = null;

    if (mode === 'generate') {
      const { data: existing } = await supabase
        .from('ai_generated_documents')
        .select('id, document_number, document_date, document_seq, file_path, status')
        .eq('idempotency_key', idempotencyKey)
        .is('deleted_at', null)
        .maybeSingle();

      if (existing) {
        preCreatedDocId = existing.id;
        allocatedNumber = existing.document_number ?? null;
        allocatedDate = existing.document_date ?? null;
        allocatedSeq = existing.document_seq ?? null;
      } else if (needsNumbering) {
        const { data: pre, error: preErr } = await supabase
          .from('ai_generated_documents')
          .insert({
            profile_id: order.profile_id,
            template_id: tpl.id,
            template_name: tpl.name,
            template_source_path: ver.storage_path,
            template_version_id: ver.id,
            template_version: ver.version_number,
            title: docTitle,
            status: 'pending',
            storage_bucket: 'documents',
            snapshot: {},
            missing_tokens: [],
            meta: { strict: true, c5g_pre_created: true, ...packageMetaExtras },
            context_type: ctxType,
            context_id: ctxId,
            idempotency_key: idempotencyKey,
            created_by: userId,
          })
          .select('id')
          .single();
        if (preErr) return json({ error: `pre_create_failed:${preErr.message}` }, 500);
        preCreatedDocId = pre.id;
      }

      if (needsNumbering && preCreatedDocId && !allocatedNumber) {
        const { data: alloc, error: allocErr } = await supabase.rpc('allocate_document_number', {
          p_document_id: preCreatedDocId,
        });
        if (allocErr) return json({ error: `allocate_failed:${allocErr.message}` }, 500);
        const row: any = Array.isArray(alloc) ? alloc[0] : alloc;
        allocatedNumber = row?.document_number ?? null;
        allocatedDate = row?.document_date ?? null;
        allocatedSeq = row?.document_seq ?? null;
      }

      // Inject in docFields ONCE — все вхождения плейсхолдеров возьмут это значение.
      if (allocatedNumber && foundIds.has(FLD_DOC_NUMBER)) {
        docFields[FLD_DOC_NUMBER] = {
          value: allocatedNumber,
          source: 'system_generated',
          updated_at: new Date().toISOString(),
        };
      }
      if (allocatedDate && foundIds.has(FLD_DOC_DATE)) {
        docFields[FLD_DOC_DATE] = {
          value: allocatedDate,
          source: 'system_generated',
          updated_at: new Date().toISOString(),
        };
      }
    }

    // Resolve fields
    const allIds = Array.from(foundIds);
    const resolved: Record<string, string> = {};
    const sourceTrace: Record<string, any> = {};
    const missing: string[] = [];
    const requiredEmpty: string[] = [];

    // Load registry labels (for source_trace richness)
    const { data: regRows } = await supabase
      .from('fields_registry')
      .select('public_id, label, entity_type, data_type')
      .in('public_id', allIds.length > 0 ? allIds : ['__none__']);
    const regMap = new Map((regRows || []).map((r: any) => [r.public_id, (r as any)]));

    // Базовое значение для каждого FLD (без модификаторов).
    const baseValueByFld: Record<string, string> = {};
    const baseEntryByFld: Record<string, any> = {};
    for (const fid of allIds) {
      const entry = docFields[fid];
      baseEntryByFld[fid] = entry;
      baseValueByFld[fid] = entry ? fmtVal(entry.value) : '';
    }

    // Заполняем resolved для каждого уникального плейсхолдера (с учётом modifiers).
    // C5-A: реально применяем format=words (number/money/date) и format=text (boolean).
    // case=… пока не применяется (C5-B) — оставляем warning.
    const orderCurrency = (order as any)?.currency || null;
    const appliedFormatByPlaceholder: Record<string, boolean> = {};
    const appliedCaseByPlaceholder: Record<string, boolean> = {};
    const caseReasonByPlaceholder: Record<string, string | null> = {};
    const seenPlaceholders = new Set<string>();
    for (const t of parsedTokens) {
      if (seenPlaceholders.has(t.raw_inside)) continue;
      seenPlaceholders.add(t.raw_inside);
      const entry = baseEntryByFld[t.field_public_id];
      const reg: any = regMap.get(t.field_public_id);
      const dt = ((reg?.data_type as string) || '').toLowerCase();
      const regKey: string = ((reg?.key as string) || '').toLowerCase();
      const rawValue = entry?.value;
      const fmt = applyFormat(rawValue, dt, orderCurrency, t.format);
      let outVal = fmt.value;
      let fmtApplied = fmt.applied;

      // format=long разрешён ТОЛЬКО для *.leg.org_form. Для всех остальных
      // полей (особенно short_name) этот модификатор игнорируется, чтобы
      // «Краткое название» никогда не превращалось в «Закрытое акционерное
      // общество «АЖУР инкам»».
      if (t.format === 'long') {
        if (/\.leg\.org_form$/.test(regKey)) {
          outVal = expandOrgFormToLong(outVal);
          fmtApplied = true;
        }
        // На *.leg.short_name и любых других FLD format=long — no-op.
      }

      // Должность руководителя — ВСЕГДА нормализуется в мужской род,
      // даже без case-модификатора (FLD-000339 без case → «Управляющий»).
      const isDirectorPosition = /\.director_position$/.test(regKey)
        || regKey === 'customer.director_position'
        || regKey === 'executor.director_position';
      if (isDirectorPosition && outVal) {
        outVal = normalizeMasculinePosition(outVal);
      }

      let caseApplied = false;
      let caseReason: string | null = null;
      if (t.case_modifier) {
        const allowText = TEXT_DT.has(dt) || dt === '' || dt === 'enum';
        const wordsApplied = fmtApplied && t.format === 'words';
        if (allowText || wordsApplied) {
          // Pipeline для должности: normalizeMasculinePosition (выше) →
          // inflectRu(case, forceGender='m'). Женская форма не выводится.
          const inf = isDirectorPosition
            ? inflectRu(outVal, t.case_modifier as RuCase, { forceGender: 'm' })
            : inflectRu(outVal, t.case_modifier as RuCase);
          if (inf.applied) { outVal = inf.value; caseApplied = true; }
          else { caseReason = inf.reason || 'inflection_unsafe'; }
        } else {
          caseReason = 'case_on_non_text_field_without_words';
        }
      }
      resolved[t.raw_inside] = outVal;
      appliedFormatByPlaceholder[t.raw_inside] = fmtApplied;
      appliedCaseByPlaceholder[t.raw_inside] = caseApplied;
      caseReasonByPlaceholder[t.raw_inside] = caseReason;
    }

    // ── Sprint 3I-A-1.B: resolve package/ln tokens from preresolved bags ──
    // Reuses the SAME `resolved` map → same Docxtemplater render below.
    if (generationContext === 'package_session') {
      for (const pt of parsedPackageTokens) {
        const bag = pt.kind === 'ln'
          ? packageContext!.preresolved_ln_tokens
          : packageContext!.preresolved_package_fields;
        const entry: any = (bag as any)[pt.bag_key];
        let outVal = fmtVal(entry?.value);
        let formatApplied = false;
        let caseApplied = false;
        let caseReason: string | null = null;
        // Sprint 3J: format=long допустим только для package.*.org_form
        // (паритет с billing executor.leg.org_form / customer.leg.org_form).
        if (pt.kind === 'package' && pt.format === 'long' && /\.org_form$/.test(pt.bag_key)) {
          outVal = expandOrgFormToLong(outVal);
          formatApplied = true;
        }
        if (pt.case_modifier) {
          const inf = inflectRu(outVal, pt.case_modifier as RuCase);
          if (inf.applied) { outVal = inf.value; caseApplied = true; }
          else { caseReason = inf.reason || 'inflection_unsafe'; }
        }
        resolved[pt.raw_inside] = outVal;
        sourceTrace[pt.raw_inside] = {
          status: outVal === '' ? 'empty' : 'resolved',
          source: entry?.source || (pt.kind === 'ln' ? 'package_ln' : 'package_requisite'),
          kind: pt.kind,
          bag_key: pt.bag_key,
          value: outVal,
          format_applied: formatApplied,
          case_applied: caseApplied,
          case_reason: caseReason,
        };
      }
    }



    for (const fid of allIds) {
      const entry = baseEntryByFld[fid];
      const reg: any = regMap.get(fid);
      const required = requiredIds.has(fid);
      const dataType = ((reg?.data_type as string) || '').toLowerCase();
      const variants = parsedTokens.filter((t) => t.field_public_id === fid);
      const modifierWarnings: string[] = [];
      const variantsTrace: any[] = [];
      const seenV = new Set<string>();
      for (const v of variants) {
        if (seenV.has(v.raw_inside)) continue;
        seenV.add(v.raw_inside);
        const w: string[] = [];
        const applied = appliedFormatByPlaceholder[v.raw_inside] === true;
        const caseApplied = appliedCaseByPlaceholder[v.raw_inside] === true;
        if (v.format === 'words') {
          if (!applied) w.push('format_words_not_applied');
          if (TEXT_DT.has(dataType)) w.push('format_words_on_text_field');
        }
        if (v.format === 'text') {
          if (!applied) w.push('format_text_not_applied');
          if (dataType !== 'boolean') w.push('format_text_on_non_boolean_field');
        }
        if (v.format === 'short' || v.format === 'dd.MM.yyyy' || v.format === 'long_ru' || v.format === 'words_ru') {
          if (!applied) w.push('format_date_not_applied');
          if (dataType !== 'date' && dataType !== 'datetime') w.push('format_date_on_non_date_field');
        }
        if (v.case_modifier) {
          if (!caseApplied) w.push('case_modifier_not_applied');
          if (NUM_DT.has(dataType) && v.format !== 'words') {
            w.push('case_on_non_text_field_without_words');
          }
        }
        if (w.length > 0) modifierWarnings.push(...w);
        variantsTrace.push({
          placeholder: `{{${v.raw_inside}}}`,
          format: v.format,
          case: v.case_modifier,
          format_applied: applied,
          case_applied: caseApplied,
          case_reason: caseReasonByPlaceholder[v.raw_inside] ?? null,
          rendered_value: resolved[v.raw_inside] ?? '',
          warnings: w,
        });
      }

      if (!entry) {
        sourceTrace[fid] = {
          status: 'missing',
          source: 'none',
          field_public_id: fid,
          label: reg?.label ?? null,
          data_type: dataType || null,
          required,
          variants: variantsTrace,
          warnings: Array.from(new Set(modifierWarnings)),
        };
        missing.push(fid);
        if (required) requiredEmpty.push(fid);
        continue;
      }
      const val = baseValueByFld[fid];
      sourceTrace[fid] = {
        status: val === '' ? 'empty' : 'resolved',
        source: entry.source ?? 'manual_override',
        manual_override: !!entry.manual_override,
        updated_at: entry.updated_at ?? null,
        updated_by: entry.updated_by ?? null,
        field_public_id: fid,
        label: reg?.label ?? null,
        data_type: dataType || null,
        value: val,
        required,
        variants: variantsTrace,
        warnings: Array.from(new Set(modifierWarnings)),
      };
      if (required && val === '') requiredEmpty.push(fid);
    }

    if (mode === 'preview') {
      return json({
        success: true,
        mode: 'preview',
        template: { id: tpl.id, name: tpl.name, version_id: ver.id, version_number: ver.version_number },
        resolver_version: RESOLVER_VERSION,
        found_field_ids: allIds,
        resolved_tokens: resolved,
        missing_field_ids: missing,
        required_empty_field_ids: requiredEmpty,
        source_trace: sourceTrace,
        can_generate: requiredEmpty.length === 0,
      });
    }

    // ── generate ─────────────────────────────────────────
    if (requiredEmpty.length > 0) {
      return json({
        error: 'required_fields_empty',
        required_empty_field_ids: requiredEmpty,
      }, 400);
    }

    const docx = new Docxtemplater(zip, {
      delimiters: { start: '{{', end: '}}' },
      paragraphLoop: true,
      linebreaks: true,
      // Кастомный parser: трактуем весь tag как имя переменной (включая `|format=…|case=…`),
      // чтобы docxtemplater не интерпретировал `|` как filter.
      parser: (tag: string) => ({
        get: (scope: any) => {
          const key = (tag || '').trim();
          if (scope && Object.prototype.hasOwnProperty.call(scope, key)) return scope[key];
          return '';
        },
      }) as any,
    });
    try {
      docx.render(resolved);
    } catch (e: any) {
      return json({ error: `render_failed:${e?.message || 'unknown'}` }, 500);
    }

    // ── Core props patch: перезаписываем dc:title / dc:creator / lastModifiedBy
    // в docProps/core.xml, чтобы во вкладке браузера/в свойствах PDF не светилось
    // унаследованное от шаблона имя ("Клиенты - январь - 01-2019" и т.п.).
    // Считаем итоговое имя файла ДО сериализации, чтобы и DOCX, и PDF
    // (генерируемый из этого DOCX через Gotenberg) имели одинаковый title.
    const _filenameTokenMapEarly: Record<string, string> = {};
    for (const fld of filenameFlds) {
      const directKey = `field:${fld}`;
      if (Object.prototype.hasOwnProperty.call(resolved, directKey)) {
        _filenameTokenMapEarly[fld] = resolved[directKey] ?? '';
        continue;
      }
      const reg: any = regMap.get(fld);
      const dt = ((reg?.data_type as string) || '').toLowerCase();
      const entry = baseEntryByFld[fld];
      const fmtKey = (dt === 'date' || dt === 'datetime') ? 'dd.MM.yyyy' : null;
      const fmt = applyFormat(entry?.value, dt, orderCurrency, fmtKey);
      _filenameTokenMapEarly[fld] = fmt.value ?? baseValueByFld[fld] ?? '';
    }
    let _earlyFileName: string;
    if (fileNameTemplate && fileNameTemplate.trim()) {
      const r = renderFileName(fileNameTemplate, { resolvedTokens: _filenameTokenMapEarly });
      _earlyFileName = r.name || buildDefaultFileName({
        templateName: tpl.name,
        documentNumber: allocatedNumber,
        documentDate: allocatedDate,
      });
    } else {
      _earlyFileName = buildDefaultFileName({
        templateName: tpl.name,
        documentNumber: allocatedNumber,
        documentDate: allocatedDate,
      });
    }
    try {
      const { patchDocxCoreProps } = await import('../_shared/docx-core-props.ts');
      patchDocxCoreProps(docx.getZip() as any, {
        title: _earlyFileName,
        creator: 'Gorbova Club',
      });
    } catch (e) {
      console.warn('[strict] patchDocxCoreProps failed (non-fatal)', e);
    }

    const out = docx.getZip().generate({ type: 'uint8array' });

    // ── C5-J: DOCX → PDF через Gotenberg ──────────────────────────────────
    // ВАЖНО для C5-G: если Gotenberg падает, мы НЕ обновляем pre-created row
    // и НЕ откатываем номер. На повторный вызов с тем же idempotency_key
    // строка переиспользуется (тот же document_number), Gotenberg ретраится.
    let pdfBuffer: Uint8Array;
    let gotenbergMeta: Record<string, unknown> = {};
    try {
      const cfg = await loadGotenbergConfig(supabase);
      if (!cfg.enabled) {
        return json({ error: 'gotenberg_disabled', code: 'GOTENBERG_DISABLED' }, 503);
      }
      const t0 = Date.now();
      pdfBuffer = await convertDocxToPdf(cfg, out, `${tpl.name}.docx`);
      gotenbergMeta = {
        gotenberg_url: cfg.url,
        gotenberg_latency_ms: Date.now() - t0,
        gotenberg_pdf_size: pdfBuffer.length,
        gotenberg_docx_size: out.length,
      };
      await supabase.from('audit_logs').insert({
        actor_user_id: userId,
        actor_type: auditActorType,
        action: 'document.pdf_converted',
        meta: { template_id: tpl.id, ...auditContext, ...gotenbergMeta },
      });
    } catch (e: any) {
      const code = e instanceof GotenbergError ? e.code : 'GOTENBERG_UNREACHABLE';
      const msg = e?.message || 'gotenberg_failed';
      await supabase.from('audit_logs').insert({
        actor_user_id: userId,
        actor_type: auditActorType,
        action: 'document.pdf_failed',
        meta: { template_id: tpl.id, ...auditContext, code, error: msg, idempotency_key: idempotencyKey },
      });
      return json({ error: 'pdf_conversion_failed', code, message: msg }, 502);
    }

    const ts = Date.now();
    const pathPrefix = generationContext === 'package_session'
      ? `generated/package/${packageContext!.package_session_id}`
      : `generated/${order.id}`;
    const docxPath = `${pathPrefix}/${ts}-${tpl.id.slice(0, 8)}.docx`;
    const pdfPath = `${pathPrefix}/${ts}-${tpl.id.slice(0, 8)}.pdf`;


    const upPdf = await supabase.storage.from('documents').upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: false,
    });
    if (upPdf.error) return json({ error: `upload_pdf_failed:${upPdf.error.message}` }, 500);

    const upDocx = await supabase.storage.from('documents').upload(docxPath, out, {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      upsert: false,
    });
    if (upDocx.error) return json({ error: `upload_docx_failed:${upDocx.error.message}` }, 500);

    // ── PATCH-B: file_name_template render (FLD-first canon) ──────────────
    // fileNameTemplate / filenameFlds уже загружены до numbering-блока (см. выше).
    // Строим FLD-keyed map для renderFileName: ключ = "FLD-XXXXXX".
    const filenameTokenMap: Record<string, string> = {};
    for (const fld of filenameFlds) {
      // 1) если в DOCX есть точный токен `field:FLD-XXX` без модификаторов — берём готовое
      const directKey = `field:${fld}`;
      if (Object.prototype.hasOwnProperty.call(resolved, directKey)) {
        filenameTokenMap[fld] = resolved[directKey] ?? '';
        continue;
      }
      // 2) FLD используется только в имени файла — резолвим из docFields через applyFormat
      const reg: any = regMap.get(fld);
      const dt = ((reg?.data_type as string) || '').toLowerCase();
      const entry = baseEntryByFld[fld];
      // Для date/datetime принудительно DD.MM.YYYY (как в DOCX-резолвере по умолчанию).
      const fmtKey = (dt === 'date' || dt === 'datetime') ? 'dd.MM.yyyy' : null;
      const fmt = applyFormat(entry?.value, dt, orderCurrency, fmtKey);
      filenameTokenMap[fld] = fmt.value ?? baseValueByFld[fld] ?? '';
    }

    let fileNameWarnings: string[] = [];
    let fileNameTemplateSource: 'template' | 'system_default' = 'system_default';
    let renderedFileName: string;
    if (fileNameTemplate && fileNameTemplate.trim()) {
      const r = renderFileName(fileNameTemplate, { resolvedTokens: filenameTokenMap });
      fileNameWarnings = r.warnings;
      if (r.name) {
        renderedFileName = r.name;
        fileNameTemplateSource = 'template';
      } else {
        renderedFileName = buildDefaultFileName({
          templateName: tpl.name,
          documentNumber: allocatedNumber,
          documentDate: allocatedDate,
        });
        fileNameWarnings.push('file_name_fallback_to_default');
      }
    } else {
      renderedFileName = buildDefaultFileName({
        templateName: tpl.name,
        documentNumber: allocatedNumber,
        documentDate: allocatedDate,
      });
    }

    // ai_generated_documents.file_name хранится БЕЗ расширения для PDF
    // (download / send добавляют .pdf или .docx из mime).
    const renderedFileNameWithExt = `${renderedFileName}.pdf`;
    const renderedDocxName = `${renderedFileName}.docx`;

    const docCommon = {
      profile_id: order.profile_id,
      template_id: tpl.id,
      template_name: tpl.name,
      template_source_path: ver.storage_path,
      template_version_id: ver.id,
      template_version: ver.version_number,
      title: docTitle,
      status: 'generated',
      // PRIMARY = PDF (клиент видит только его)
      file_path: pdfPath,
      file_name: renderedFileNameWithExt,
      file_mime: 'application/pdf',
      storage_bucket: 'documents',
      snapshot: { fields: docFields },
      missing_tokens: missing,
      token_manifest_snapshot: manifest,
      template_tokens_snapshot: allIds.map((f) => `field:${f}`),
      warnings_snapshot: (() => {
        const w: string[] = [];
        if (b97FallbackApplied > 0) w.push(`b97_live_fallback_used:${b97FallbackApplied}:non_empty=${b97FallbackNonEmpty}`);
        if (b97FallbackApplied > 0 && !b97LiveCustomer) w.push('b97_customer_requisites_missing_for_payer_type');
        if (b97FallbackApplied > 0 && !b97LiveExecutor) w.push('b97_executor_missing');
        if (fileNameWarnings.length > 0) w.push(...fileNameWarnings);
        return w;
      })(),
      source_trace: sourceTrace,
      resolver_version: RESOLVER_VERSION,
      context_type: ctxType,
      context_id: ctxId,
      idempotency_key: idempotencyKey,
      created_by: userId,
      meta: {
        strict: true,
        // SECONDARY = DOCX (admin-only download через UI guard)
        docx_storage_path: docxPath,
        docx_file_name: renderedDocxName,
        docx_mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        // PATCH-B: snapshot имени файла + источник + warnings.
        file_name_template_snapshot: fileNameTemplate,
        file_name_template_source: fileNameTemplateSource,
        file_name_warnings: fileNameWarnings,
        ...gotenbergMeta,
        ...packageMetaExtras,
      },
    } as any;

    let documentId: string;
    if (preCreatedDocId) {
      // immutability trigger пропускает doc_number/date/seq (OLD=NEW)
      const { error: updErr } = await supabase
        .from('ai_generated_documents')
        .update(docCommon)
        .eq('id', preCreatedDocId);
      if (updErr) return json({ error: `update_failed:${updErr.message}` }, 500);
      documentId = preCreatedDocId;
    } else {
      const { data: insRow, error: insErr } = await supabase
        .from('ai_generated_documents')
        .insert(docCommon)
        .select('id')
        .single();
      if (insErr) return json({ error: `insert_failed:${insErr.message}` }, 500);
      documentId = insRow.id;
    }

    // Canonical download URL on our own domain. NEVER expose *.supabase.co
    // storage signed URLs to the client / customer.
    const appBase = (Deno.env.get('PUBLIC_SITE_URL') || 'https://gorbova.by').replace(/\/+$/, '');
    const canonicalDownloadUrl = `${appBase}/document-download/${documentId}`;

    await supabase.from('audit_logs').insert({
      actor_user_id: userId,
      actor_type: auditActorType,
      action: 'document.generated',
      meta: {
        document_id: documentId,
        ...auditContext,
        template_id: tpl.id,
        template_version_id: ver.id,
        version_number: ver.version_number,
        field_ids: allIds,
        resolver_version: RESOLVER_VERSION,
        document_number: allocatedNumber,
        document_date: allocatedDate,
        document_seq: allocatedSeq,
        file_mime: 'application/pdf',
        ...gotenbergMeta,
      },
    });

    return json({
      success: true,
      mode: 'generate',
      document_id: documentId,
      file_mime: 'application/pdf',
      download_url: canonicalDownloadUrl,
      template: { id: tpl.id, version_id: ver.id, version_number: ver.version_number },
      resolver_version: RESOLVER_VERSION,
      document_number: allocatedNumber,
      document_date: allocatedDate,
    });
  } catch (e: any) {
    console.error('canonical-document-generate-strict error:', e);
    return json({ error: e?.message || 'internal_error' }, 500);
  }
});
