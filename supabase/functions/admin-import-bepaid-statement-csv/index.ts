import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BUILD_ID = "2026-02-02T12:00:00Z-csv-import-v1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Column mapping: Russian CSV headers → DB fields
 * Only clean Russian UTF-8 headers from bePaid CSV export
 */
const COLUMN_MAP: Record<string, string> = {
  // Common fields
  'uid': 'uid',
  'id заказа': 'order_id_bepaid',
  'статус': 'status',
  'описание': 'description',
  'сумма': 'amount',
  'валюта': 'currency',
  'комиссия,%': 'commission_percent',
  'комиссия за операцию': 'commission_per_op',
  'сумма комиссий': 'commission_total',
  'перечисленная сумма': 'payout_amount',
  'тип транзакции': 'transaction_type',
  'трекинг id': 'tracking_id',
  'дата создания': 'created_at_bepaid',
  'дата оплаты': 'paid_at',
  'дата перечисления': 'payout_date',
  'действует до': 'expires_at',
  'сообщение': 'message',
  'id магазина': 'shop_id',
  'магазин': 'shop_name',
  'категория бизнеса': 'business_category',
  'id банка': 'bank_id',
  'имя': 'first_name',
  'фамилия': 'last_name',
  'адрес': 'address',
  'страна': 'country',
  'город': 'city',
  'индекс': 'zip',
  'область': 'region',
  'телефон': 'phone',
  'ip': 'ip',
  'e-mail': 'email',
  'email': 'email',
  'способ оплаты': 'payment_method',
  'код продукта': 'product_code',
  'карта': 'card_masked',
  'владелец карты': 'card_holder',
  'карта действует': 'card_expires',
  'bin карты': 'card_bin',
  'банк': 'bank_name',
  'страна банка': 'bank_country',
  '3-d secure': 'secure_3d',
  'результат avs': 'avs_result',
  'fraud': 'fraud',
  'код авторизации': 'auth_code',
  'rrn': 'rrn',
  'причина': 'reason',
  'идентификатор оплаты': 'payment_identifier',
  'провайдер токена': 'token_provider',
  'id торговца': 'merchant_id',
  'страна торговца': 'merchant_country',
  'компания торговца': 'merchant_company',
  'сумма после конвертации': 'converted_amount',
  'валюта после конвертации': 'converted_currency',
  'id шлюза': 'gateway_id',
  'рекуррентный тип': 'recurring_type',
  'card bin (8)': 'card_bin_8',
  'код банка': 'bank_code',
  'код ответа': 'response_code',
  'курс конвертации': 'conversion_rate',
  'перечисленная сумма после конвертации': 'converted_payout',
  'сумма комиссий в валюте после конвертации': 'converted_commission',
  // ERIP-specific
  'код услуги': 'product_code',
  'сокращенное наименование услуги': 'description',
  'номера счета': 'payment_identifier',
  'номер запроса ерип': 'bank_id',
  'номер операции ерип': 'auth_code',
  'код агента': 'bank_code',
  'расчетный агент': 'bank_name',
  'номер мемориального ордера': 'rrn',
  'тип авторизации': 'recurring_type',
  'описание типа авторизации': 'reason',
  'код устройства авторизации': 'gateway_id',
  'описание типа устройства': 'token_provider',
  'номер счета плательщика': 'payment_identifier',
  'код региона плательщика': 'region',
  'фио плательщика': 'card_holder',
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

/**
 * Parse server date: "2026-01-06 09:58:06 +0300" → ISO string
 */
function parseServerDate(dateStr: string): string | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const trimmed = dateStr.trim();
  if (!trimmed) return null;
  
  // Pattern: YYYY-MM-DD HH:mm:ss +0300 → +03:00
  const match = trimmed.match(
    /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+([+-])(\d{2})(\d{2})$/
  );
  if (match) {
    const [, date, time, sign, tzH, tzM] = match;
    const isoStr = `${date}T${time}${sign}${tzH}:${tzM}`;
    const d = new Date(isoStr);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  
  // Fallback: try direct parse
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) return d.toISOString();
  
  return null;
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
 * Simple CSV parser for server-side (handles quoted fields)
 */
function parseCSV(csvText: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = csvText.split(/\r?\n/);
  if (lines.length < 2) return { headers: [], rows: [] };
  
  // Find header row (skip empty lines)
  let headerIdx = 0;
  while (headerIdx < lines.length && !lines[headerIdx].trim()) {
    headerIdx++;
  }
  if (headerIdx >= lines.length) return { headers: [], rows: [] };
  
  const headerLine = lines[headerIdx];
  const headers = parseCSVLine(headerLine).map(normalizeHeader);
  
  const rows: Record<string, string>[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const values = parseCSVLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] || '';
    });
    rows.push(row);
  }
  
  return { headers, rows };
}

/**
 * Parse a single CSV line (handles quoted fields with commas)
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];
    
    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        current += '"';
        i++; // skip escaped quote
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',' || char === ';') {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
  }
  result.push(current.trim());
  
  return result;
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

    // Verify admin role
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: roleData } = await supabase
      .from('user_roles_v2')
      .select('role')
      .eq('user_id', user.id)
      .in('role', ['admin', 'superadmin'])
      .maybeSingle();

    if (!roleData) {
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

    // Parse CSV on server
    const { headers, rows: rawRows } = parseCSV(csv_text);
    console.log(`[${BUILD_ID}] Parsed ${rawRows.length} raw rows, headers: ${headers.slice(0, 5).join(', ')}...`);

    // Apply limit
    const limitedRows = rawRows.slice(0, limit);

    // Map and validate rows
    const validRows: ParsedRow[] = [];
    const invalidRows: { row: number; reason: string }[] = [];
    
    for (let i = 0; i < limitedRows.length; i++) {
      const rawRow = limitedRows[i];
      const parsedRow: ParsedRow = { uid: '', raw_data: rawRow };
      
      // Map columns
      for (const [csvHeader, dbField] of Object.entries(COLUMN_MAP)) {
        const value = rawRow[csvHeader];
        if (value === undefined || value === '') continue;
        
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
      total_rows: limitedRows.length,
      valid_rows: finalRows.length,
      invalid_rows: invalidRows.length,
      invalid_rate: limitedRows.length > 0 ? (invalidRows.length / limitedRows.length) : 0,
      duplicates_merged: duplicatesMerged,
    };

    console.log(`[${BUILD_ID}] Stats: valid=${stats.valid_rows}, invalid=${stats.invalid_rows}, rate=${(stats.invalid_rate * 100).toFixed(1)}%`);

    // DRY-RUN: return stats only
    if (dry_run) {
      // Audit log
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
    let created = 0;
    let updated = 0;
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
        created += batch.length;
      }
    }

    // Audit log
    await supabase.from('audit_logs').insert({
      action: 'bepaid_csv_import.execute',
      actor_type: 'system',
      actor_user_id: null,
      actor_label: `admin-import-bepaid-statement-csv/${BUILD_ID}`,
      meta: {
        build_id: BUILD_ID,
        initiator_user_id: user.id,
        ...stats,
        created,
        updated,
        errors,
      },
    });

    console.log(`[${BUILD_ID}] END: created=${created}, errors=${errors}`);

    return new Response(JSON.stringify({
      success: true,
      mode: 'execute',
      build_id: BUILD_ID,
      stats,
      created,
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
