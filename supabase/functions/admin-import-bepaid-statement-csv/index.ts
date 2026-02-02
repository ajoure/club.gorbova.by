import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { parse as csvParse } from "https://deno.land/std@0.224.0/csv/parse.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BUILD_ID = "2026-02-02T14:30:00Z-csv-import-v2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Raw column mapping: readable keys → DB fields
 * Keys will be normalized via normalizeHeader() before lookup
 */
const RAW_COLUMN_MAP: Record<string, string> = {
  // Common fields
  'UID': 'uid',
  'ID заказа': 'order_id_bepaid',
  'Статус': 'status',
  'Описание': 'description',
  'Сумма': 'amount',
  'Валюта': 'currency',
  'Комиссия,%': 'commission_percent',
  'Комиссия, %': 'commission_percent',
  'Комиссия за операцию': 'commission_per_op',
  'Сумма комиссий': 'commission_total',
  'Перечисленная сумма': 'payout_amount',
  'Тип транзакции': 'transaction_type',
  'Трекинг ID': 'tracking_id',
  'Дата создания': 'created_at_bepaid',
  'Дата оплаты': 'paid_at',
  'Дата перечисления': 'payout_date',
  'Действует до': 'expires_at',
  'Сообщение': 'message',
  'ID магазина': 'shop_id',
  'Магазин': 'shop_name',
  'Категория бизнеса': 'business_category',
  'ID банка': 'bank_id',
  'Имя': 'first_name',
  'Фамилия': 'last_name',
  'Адрес': 'address',
  'Страна': 'country',
  'Город': 'city',
  'Индекс': 'zip',
  'Область': 'region',
  'Телефон': 'phone',
  'IP': 'ip',
  'E-mail': 'email',
  'Email': 'email',
  'Способ оплаты': 'payment_method',
  'Код продукта': 'product_code',
  'Карта': 'card_masked',
  'Владелец карты': 'card_holder',
  'Карта действует': 'card_expires',
  'BIN карты': 'card_bin',
  'Банк': 'bank_name',
  'Страна банка': 'bank_country',
  '3-D Secure': 'secure_3d',
  'Результат AVS': 'avs_result',
  'Fraud': 'fraud',
  'Код авторизации': 'auth_code',
  'RRN': 'rrn',
  'Причина': 'reason',
  'Идентификатор оплаты': 'payment_identifier',
  'Провайдер токена': 'token_provider',
  'ID торговца': 'merchant_id',
  'Страна торговца': 'merchant_country',
  'Компания торговца': 'merchant_company',
  'Сумма после конвертации': 'converted_amount',
  'Валюта после конвертации': 'converted_currency',
  'ID шлюза': 'gateway_id',
  'Рекуррентный тип': 'recurring_type',
  'Card BIN (8)': 'card_bin_8',
  'Код банка': 'bank_code',
  'Код ответа': 'response_code',
  'Курс конвертации': 'conversion_rate',
  'Перечисленная сумма после конвертации': 'converted_payout',
  'Сумма комиссий в валюте после конвертации': 'converted_commission',
  // ERIP-specific
  'Код услуги': 'product_code',
  'Сокращенное наименование услуги': 'description',
  'Номера счета': 'payment_identifier',
  'Номер запроса ЕРИП': 'bank_id',
  'Номер операции ЕРИП': 'auth_code',
  'Код агента': 'bank_code',
  'Расчетный агент': 'bank_name',
  'Номер мемориального ордера': 'rrn',
  'Тип авторизации': 'recurring_type',
  'Описание типа авторизации': 'reason',
  'Код устройства авторизации': 'gateway_id',
  'Описание типа устройства': 'token_provider',
  'Номер счета плательщика': 'payment_identifier',
  'Код региона плательщика': 'region',
  'ФИО плательщика': 'card_holder',
};

const DATE_FIELDS = ['created_at_bepaid', 'paid_at', 'payout_date', 'expires_at'];
const NUMBER_FIELDS = [
  'amount', 'commission_percent', 'commission_per_op', 'commission_total',
  'payout_amount', 'converted_amount', 'converted_payout', 'converted_commission', 'conversion_rate'
];

/**
 * Normalize header: trim, lowercase, remove BOM/zero-width chars, collapse spaces
 */
function normalizeHeader(h: string): string {
  return h
    .replace(/^\uFEFF/, '') // BOM
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // zero-width chars
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Build normalized COLUMN_MAP at init time
const COLUMN_MAP: Record<string, string> = {};
for (const [rawKey, dbField] of Object.entries(RAW_COLUMN_MAP)) {
  COLUMN_MAP[normalizeHeader(rawKey)] = dbField;
}

/**
 * Parse server date WITHOUT converting to UTC (keep offset ISO)
 * "2026-01-06 09:58:06 +0300" → "2026-01-06T09:58:06+03:00"
 */
function parseServerDate(dateStr: string): string | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const trimmed = dateStr.trim();
  if (!trimmed) return null;
  
  // Pattern: YYYY-MM-DD HH:mm:ss +0300 → YYYY-MM-DDTHH:mm:ss+03:00
  const match = trimmed.match(
    /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+([+-])(\d{2})(\d{2})$/
  );
  if (match) {
    const [, date, time, sign, tzH, tzM] = match;
    // Return ISO with original offset, NO toISOString()
    return `${date}T${time}${sign}${tzH}:${tzM}`;
  }
  
  // Already ISO-like (starts with YYYY-MM-DDT) → return as-is
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(trimmed)) {
    return trimmed;
  }
  
  // Date-only (no time) → add 00:00:00+03:00 (provider offset)
  const dateOnlyMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (dateOnlyMatch) {
    return `${dateOnlyMatch[1]}T00:00:00+03:00`;
  }
  
  return null; // unrecognized format
}

/**
 * Parse number: handles 800.00 and 800,00 formats
 */
function parseNumber(val: string): number | null {
  if (!val || typeof val !== 'string') return null;
  const cleaned = val.replace(/\s/g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * Detect CSV delimiter by counting occurrences in header line
 */
function detectDelimiter(csvText: string): string {
  // Take first non-empty lines (up to 5) for analysis
  const lines = csvText.split(/\r?\n/).filter(l => l.trim()).slice(0, 5);
  if (lines.length === 0) return ';';
  
  const headerLine = lines[0];
  
  // Count delimiters outside quotes
  let semicolons = 0;
  let commas = 0;
  let inQuotes = false;
  
  for (const char of headerLine) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes) {
      if (char === ';') semicolons++;
      if (char === ',') commas++;
    }
  }
  
  // Prefer semicolon if equal (common in Russian CSV)
  return semicolons >= commas ? ';' : ',';
}

interface ParsedRow {
  uid: string;
  [key: string]: unknown;
}

serve(async (req) => {
  console.log(`[${BUILD_ID}] START admin-import-bepaid-statement-csv`);
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify admin role (PATCH-4: join with roles table, check code)
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Join user_roles_v2 with roles to get role code
    const { data: roleData } = await supabase
      .from('user_roles_v2')
      .select('role_id, roles:role_id(code)')
      .eq('user_id', user.id);

    const hasAdminRole = roleData?.some((r) => {
      const roles = r.roles as unknown;
      if (roles && typeof roles === 'object' && 'code' in roles) {
        const code = (roles as { code: string }).code;
        return code === 'admin' || code === 'super_admin';
      }
      return false;
    });

    if (!hasAdminRole) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Parse request
    const body = await req.json();
    const { dry_run = true, csv_text, source = 'bepaid_csv', limit = 5000 } = body;

    if (!csv_text || typeof csv_text !== 'string') {
      return new Response(JSON.stringify({ error: 'csv_text is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Detect delimiter
    const delimiter = detectDelimiter(csv_text);
    console.log(`[${BUILD_ID}] Detected delimiter: '${delimiter}'`);

    // Parse CSV using Deno std/csv (supports multiline quoted fields)
    let csvData: string[][];
    try {
      csvData = csvParse(csv_text, {
        separator: delimiter,
        lazyQuotes: true,
        fieldsPerRecord: 0, // allow variable field count
      });
    } catch (parseError) {
      console.error(`[${BUILD_ID}] CSV parse error:`, parseError);
      return new Response(JSON.stringify({ 
        error: `CSV parse error: ${parseError instanceof Error ? parseError.message : 'Unknown'}`,
        build_id: BUILD_ID,
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (csvData.length < 2) {
      return new Response(JSON.stringify({ 
        error: 'CSV must have header row and at least one data row',
        build_id: BUILD_ID,
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Normalize headers
    const rawHeaders = csvData[0];
    const headers = rawHeaders.map(normalizeHeader);
    console.log(`[${BUILD_ID}] Parsed ${csvData.length - 1} raw rows, headers: ${headers.slice(0, 5).join(', ')}...`);

    // Build rows as Record<normalizedHeader, value>
    const rawRows = csvData.slice(1, 1 + limit).map(rowArr => {
      const row: Record<string, string> = {};
      headers.forEach((h, i) => {
        row[h] = String(rowArr[i] ?? '').trim();
      });
      return row;
    });

    // Map and validate rows
    const validRows: ParsedRow[] = [];
    const invalidRows: { row: number; reason: string }[] = [];
    
    for (let i = 0; i < rawRows.length; i++) {
      const rawRow = rawRows[i];
      const parsedRow: ParsedRow = { uid: '', raw_data: rawRow };
      
      // Map columns using normalized COLUMN_MAP
      for (const [normalizedHeader, value] of Object.entries(rawRow)) {
        const dbField = COLUMN_MAP[normalizedHeader];
        if (!dbField || value === '') continue;
        
        if (DATE_FIELDS.includes(dbField)) {
          const parsed = parseServerDate(value);
          if (parsed) parsedRow[dbField] = parsed;
        } else if (NUMBER_FIELDS.includes(dbField)) {
          const parsed = parseNumber(value);
          if (parsed !== null) parsedRow[dbField] = parsed;
        } else {
          parsedRow[dbField] = value;
        }
        
        if (dbField === 'uid' && value) {
          parsedRow.uid = String(value);
        }
      }
      
      if (parsedRow.uid) {
        validRows.push(parsedRow);
      } else {
        invalidRows.push({ row: i + 2, reason: 'Missing UID' }); // +2 for header + 1-index
      }
    }

    // Deduplicate by UID (last-win merge)
    const deduped = new Map<string, ParsedRow>();
    for (const row of validRows) {
      const existing = deduped.get(row.uid);
      if (existing) {
        // Merge: keep existing, overwrite with new non-null
        for (const [k, v] of Object.entries(row)) {
          if (v !== null && v !== undefined && v !== '') {
            existing[k] = v;
          }
        }
      } else {
        deduped.set(row.uid, { ...row });
      }
    }
    const finalRows = Array.from(deduped.values());
    const duplicatesMerged = validRows.length - finalRows.length;

    const stats = {
      total_rows: rawRows.length,
      valid_rows: finalRows.length,
      invalid_rows: invalidRows.length,
      invalid_rate: rawRows.length > 0 ? (invalidRows.length / rawRows.length) : 0,
      duplicates_merged: duplicatesMerged,
    };

    console.log(`[${BUILD_ID}] Stats: valid=${stats.valid_rows}, invalid=${stats.invalid_rows}, rate=${(stats.invalid_rate * 100).toFixed(1)}%`);

    // DRY-RUN: return stats only
    if (dry_run) {
      // Audit log (no PII)
      await supabase.from('audit_logs').insert({
        action: 'bepaid_csv_import.dry_run',
        actor_type: 'system',
        actor_user_id: null,
        actor_label: `admin-import-bepaid-statement-csv/${BUILD_ID}`,
        meta: {
          build_id: BUILD_ID,
          initiator_user_id: user.id,
          ...stats,
        },
      });

      return new Response(JSON.stringify({
        success: true,
        mode: 'dry_run',
        build_id: BUILD_ID,
        stats,
        sample_errors: invalidRows.slice(0, 5),
        sample_parsed: finalRows.slice(0, 3).map(r => ({
          uid: r.uid,
          amount: r.amount,
          status: r.status,
          paid_at: r.paid_at,
          transaction_type: r.transaction_type,
        })),
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // EXECUTE: STOP-guard check
    if (stats.invalid_rate > 0.10 && stats.total_rows > 50) {
      return new Response(JSON.stringify({
        success: false,
        error: `STOP-guard: invalid_rate ${(stats.invalid_rate * 100).toFixed(1)}% > 10% with ${stats.total_rows} rows. Fix data or reduce batch.`,
        mode: 'execute_blocked',
        stats,
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Upsert in batches
    const BATCH_SIZE = 200;
    let upserted = 0;
    let errors = 0;
    const errorDetails: string[] = [];

    for (let i = 0; i < finalRows.length; i += BATCH_SIZE) {
      const batch = finalRows.slice(i, i + BATCH_SIZE);
      
      const upsertData = batch.map(row => ({
        uid: row.uid,
        order_id_bepaid: row.order_id_bepaid ?? null,
        status: row.status ?? null,
        description: row.description ?? null,
        amount: row.amount ?? null,
        currency: row.currency ?? null,
        commission_percent: row.commission_percent ?? null,
        commission_per_op: row.commission_per_op ?? null,
        commission_total: row.commission_total ?? null,
        payout_amount: row.payout_amount ?? null,
        transaction_type: row.transaction_type ?? null,
        tracking_id: row.tracking_id ?? null,
        created_at_bepaid: row.created_at_bepaid ?? null,
        paid_at: row.paid_at ?? null,
        payout_date: row.payout_date ?? null,
        expires_at: row.expires_at ?? null,
        message: row.message ?? null,
        shop_id: row.shop_id ?? null,
        shop_name: row.shop_name ?? null,
        business_category: row.business_category ?? null,
        bank_id: row.bank_id ?? null,
        first_name: row.first_name ?? null,
        last_name: row.last_name ?? null,
        address: row.address ?? null,
        country: row.country ?? null,
        city: row.city ?? null,
        zip: row.zip ?? null,
        region: row.region ?? null,
        phone: row.phone ?? null,
        ip: row.ip ?? null,
        email: row.email ?? null,
        payment_method: row.payment_method ?? null,
        product_code: row.product_code ?? null,
        card_masked: row.card_masked ?? null,
        card_holder: row.card_holder ?? null,
        card_expires: row.card_expires ?? null,
        card_bin: row.card_bin ?? null,
        bank_name: row.bank_name ?? null,
        bank_country: row.bank_country ?? null,
        secure_3d: row.secure_3d ?? null,
        avs_result: row.avs_result ?? null,
        fraud: row.fraud ?? null,
        auth_code: row.auth_code ?? null,
        rrn: row.rrn ?? null,
        reason: row.reason ?? null,
        payment_identifier: row.payment_identifier ?? null,
        token_provider: row.token_provider ?? null,
        merchant_id: row.merchant_id ?? null,
        merchant_country: row.merchant_country ?? null,
        merchant_company: row.merchant_company ?? null,
        converted_amount: row.converted_amount ?? null,
        converted_currency: row.converted_currency ?? null,
        gateway_id: row.gateway_id ?? null,
        recurring_type: row.recurring_type ?? null,
        card_bin_8: row.card_bin_8 ?? null,
        bank_code: row.bank_code ?? null,
        response_code: row.response_code ?? null,
        conversion_rate: row.conversion_rate ?? null,
        converted_payout: row.converted_payout ?? null,
        converted_commission: row.converted_commission ?? null,
        raw_data: row.raw_data ?? null,
        import_batch_id: BUILD_ID,
        updated_at: new Date().toISOString(),
      }));

      const { error } = await supabase
        .from('bepaid_statement_rows')
        .upsert(upsertData, { onConflict: 'uid' });

      if (error) {
        console.error(`[${BUILD_ID}] Batch ${Math.floor(i/BATCH_SIZE) + 1} error:`, error.message);
        errorDetails.push(`Batch ${Math.floor(i/BATCH_SIZE) + 1}: ${error.message}`);
        errors += batch.length;
      } else {
        upserted += batch.length;
      }
    }

    // Audit log (no PII)
    await supabase.from('audit_logs').insert({
      action: 'bepaid_csv_import.execute',
      actor_type: 'system',
      actor_user_id: null,
      actor_label: `admin-import-bepaid-statement-csv/${BUILD_ID}`,
      meta: {
        build_id: BUILD_ID,
        initiator_user_id: user.id,
        ...stats,
        upserted,
        errors,
      },
    });

    console.log(`[${BUILD_ID}] END: upserted=${upserted}, errors=${errors}`);

    return new Response(JSON.stringify({
      success: true,
      mode: 'execute',
      build_id: BUILD_ID,
      stats,
      upserted,
      errors,
      error_details: errorDetails.slice(0, 5),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error(`[${BUILD_ID}] Error:`, error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
      build_id: BUILD_ID,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
