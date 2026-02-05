import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { parse as csvParse } from "https://deno.land/std@0.168.0/encoding/csv.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const BUILD_ID = "2026-02-02T21:30:00Z-csv-import-multifile-v3";

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
 * Detect CSV delimiter by counting occurrences in header line
 */
function detectDelimiter(csvText: string): string {
  const lines = csvText.split(/\r?\n/).filter(l => l.trim()).slice(0, 5);
  if (lines.length === 0) return ';';
  
  const headerLine = lines[0];
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
  
  return semicolons >= commas ? ';' : ',';
}

/**
 * PATCH-4: Detect if file is a Totals/Summary file (not data)
 */
function isTotalsFile(name: string, headers: string[]): boolean {
  const nameLower = name.toLowerCase();
  if (nameLower.includes('total') || nameLower.includes('итог') || nameLower.includes('summary')) {
    return true;
  }
  
  // Check headers for totals indicators
  const headerStr = headers.join(' ').toLowerCase();
  if (headerStr.includes('итого') || headerStr.includes('expected') || headerStr.includes('total amount')) {
    return true;
  }
  
  return false;
}

/**
 * PATCH-4: Parse Totals CSV for expected values
 */
function parseTotalsCSV(text: string, delimiter: string): { expected_count?: number; expected_amount?: number } {
  const result: { expected_count?: number; expected_amount?: number } = {};
  
  try {
    const csvData = csvParse(text, { separator: delimiter, lazyQuotes: true, fieldsPerRecord: 0 });
    if (csvData.length < 2) return result;
    
    const headers = csvData[0].map(normalizeHeader);
    
    // Look for count/amount columns
    const countIdx = headers.findIndex(h => 
      h.includes('количество') || h.includes('count') || h.includes('кол-во')
    );
    const amountIdx = headers.findIndex(h => 
      h.includes('сумма') || h.includes('amount') || h.includes('total')
    );
    
    // Get values from first data row (or last if summary row)
    const dataRow = csvData.length > 2 ? csvData[csvData.length - 1] : csvData[1];
    
    if (countIdx >= 0 && dataRow[countIdx]) {
      const val = parseNumber(String(dataRow[countIdx]));
      if (val !== null) result.expected_count = Math.round(val);
    }
    
    if (amountIdx >= 0 && dataRow[amountIdx]) {
      const val = parseNumber(String(dataRow[amountIdx]));
      if (val !== null) result.expected_amount = val;
    }
  } catch (e) {
    console.log(`[${BUILD_ID}] Totals parse error:`, e);
  }
  
  return result;
}

interface ParsedRow {
  uid: string;
  [key: string]: unknown;
}

interface FileStats {
  name: string;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
}

interface CsvFile {
  name: string;
  text: string;
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
    const { dry_run = true, source = 'bepaid_csv', limit = 5000 } = body;
    
    // PATCH-3: Support both single csv_text and multi-file csv_texts
    let csvFiles: CsvFile[] = [];
    
    if (body.csv_texts && Array.isArray(body.csv_texts)) {
      csvFiles = body.csv_texts;
    } else if (body.csv_text && typeof body.csv_text === 'string') {
      // Legacy single-file support
      csvFiles = [{ name: 'file.csv', text: body.csv_text }];
    }
    
    if (csvFiles.length === 0) {
      return new Response(JSON.stringify({ error: 'csv_texts or csv_text is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[${BUILD_ID}] Processing ${csvFiles.length} files`);

    // PATCH-3: Process each file, separate data files from totals
    const perFileStats: FileStats[] = [];
    const allValidRows: ParsedRow[] = [];
    const allInvalidRows: { row: number; file: string; reason: string }[] = [];
    let totalsExpected: { expected_count?: number; expected_amount?: number; source_file?: string } | undefined;
    
    for (const csvFile of csvFiles) {
      const delimiter = detectDelimiter(csvFile.text);
      
      let csvData: string[][];
      try {
        csvData = csvParse(csvFile.text, {
          separator: delimiter,
          lazyQuotes: true,
          fieldsPerRecord: 0,
        });
      } catch (parseError) {
        console.error(`[${BUILD_ID}] CSV parse error for ${csvFile.name}:`, parseError);
        allInvalidRows.push({ row: 0, file: csvFile.name, reason: `Parse error: ${parseError}` });
        perFileStats.push({ name: csvFile.name, total_rows: 0, valid_rows: 0, invalid_rows: 1 });
        continue;
      }

      if (csvData.length < 2) {
        allInvalidRows.push({ row: 0, file: csvFile.name, reason: 'Empty or header-only file' });
        perFileStats.push({ name: csvFile.name, total_rows: 0, valid_rows: 0, invalid_rows: 1 });
        continue;
      }

      const rawHeaders = csvData[0];
      const headers = rawHeaders.map(normalizeHeader);
      
      // PATCH-4: Check if this is a Totals file
      if (isTotalsFile(csvFile.name, headers)) {
        console.log(`[${BUILD_ID}] Detected Totals file: ${csvFile.name}`);
        const totals = parseTotalsCSV(csvFile.text, delimiter);
        if (totals.expected_count !== undefined || totals.expected_amount !== undefined) {
          totalsExpected = { ...totals, source_file: csvFile.name };
        }
        perFileStats.push({ name: csvFile.name, total_rows: csvData.length - 1, valid_rows: 0, invalid_rows: 0 });
        continue; // Skip data processing for totals file
      }

      // Process data rows
      const rawRows = csvData.slice(1, 1 + limit).map(rowArr => {
        const row: Record<string, string> = {};
        headers.forEach((h, i) => {
          row[h] = String(rowArr[i] ?? '').trim();
        });
        return row;
      });

      let fileValidCount = 0;
      let fileInvalidCount = 0;

      for (let i = 0; i < rawRows.length; i++) {
        const rawRow = rawRows[i];
        const parsedRow: ParsedRow = { uid: '', raw_data: rawRow, _source_file: csvFile.name };
        
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
          allValidRows.push(parsedRow);
          fileValidCount++;
        } else {
          allInvalidRows.push({ row: i + 2, file: csvFile.name, reason: 'Missing UID' });
          fileInvalidCount++;
        }
      }

      perFileStats.push({
        name: csvFile.name,
        total_rows: rawRows.length,
        valid_rows: fileValidCount,
        invalid_rows: fileInvalidCount,
      });
      
      console.log(`[${BUILD_ID}] File ${csvFile.name}: ${rawRows.length} rows, ${fileValidCount} valid`);
    }

    // Deduplicate by UID (last-win merge)
    // PATCH-6: Track duplicates for explain_mismatch
    const deduped = new Map<string, ParsedRow>();
    const duplicateDetails: Array<{ uid: string; reason: string }> = [];
    
    for (const row of allValidRows) {
      const existing = deduped.get(row.uid);
      if (existing) {
        // Track duplicate for explain_mismatch
        duplicateDetails.push({
          uid: row.uid.substring(0, 16) + '...',
          reason: `duplicate_merged from ${row._source_file}`,
        });
        // Merge: keep existing, overwrite with new non-null
        for (const [k, v] of Object.entries(row)) {
          if (v !== null && v !== undefined && v !== '' && k !== '_source_file') {
            existing[k] = v;
          }
        }
      } else {
        deduped.set(row.uid, { ...row });
      }
    }
    const finalRows = Array.from(deduped.values());
    const duplicatesMerged = allValidRows.length - finalRows.length;
    
    // Calculate total amount for verification
    let totalAmount = 0;
    for (const row of finalRows) {
      if (typeof row.amount === 'number') {
        totalAmount += row.amount;
      }
    }

    const totalRowsProcessed = perFileStats.reduce((sum, f) => sum + f.total_rows, 0);
    const totalInvalidRows = allInvalidRows.length;

    const stats = {
      total_files: csvFiles.length,
      per_file: perFileStats,
      total_rows: totalRowsProcessed,
      valid_rows: allValidRows.length,
      invalid_rows: totalInvalidRows,
      invalid_rate: totalRowsProcessed > 0 ? (totalInvalidRows / totalRowsProcessed) : 0,
      duplicates_merged: duplicatesMerged,
      uids_unique: finalRows.length,
      total_amount: Math.round(totalAmount * 100) / 100,
    };

    console.log(`[${BUILD_ID}] Stats: files=${stats.total_files}, unique=${stats.uids_unique}, invalid=${stats.invalid_rows}, merged=${stats.duplicates_merged}`);

    // DRY-RUN: return stats only
    if (dry_run) {
      await supabase.from('audit_logs').insert({
        action: 'bepaid_csv_import.dry_run',
        actor_type: 'system',
        actor_user_id: null,
        actor_label: `admin-import-bepaid-statement-csv/${BUILD_ID}`,
        meta: {
          build_id: BUILD_ID,
          initiator_user_id: user.id,
          total_files: stats.total_files,
          per_file: stats.per_file,
          uids_unique: stats.uids_unique,
          duplicates_merged: stats.duplicates_merged,
          invalid_rows: stats.invalid_rows,
        },
      });

      return new Response(JSON.stringify({
        success: true,
        mode: 'dry_run',
        build_id: BUILD_ID,
        stats,
        totals_expected: totalsExpected,
        sample_errors: allInvalidRows.slice(0, 5),
        sample_parsed: finalRows.slice(0, 3).map(r => ({
          uid: r.uid,
          amount: r.amount,
          status: r.status,
          paid_at: r.paid_at,
          transaction_type: r.transaction_type,
        })),
        // PATCH-6: Include explain_mismatch with invalid rows and duplicates
        explain_mismatch: [
          ...allInvalidRows.slice(0, 10).map(e => ({
            uid: '—',
            reason: `Row ${e.row} in ${e.file}: ${e.reason}`,
          })),
          ...duplicateDetails.slice(0, 10),
        ].slice(0, 20),
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
        totals_expected: totalsExpected,
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
        total_files: stats.total_files,
        per_file: stats.per_file,
        uids_unique: stats.uids_unique,
        duplicates_merged: stats.duplicates_merged,
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
      totals_expected: totalsExpected,
      upserted,
      errors,
      error_details: errorDetails.slice(0, 5),
      sample_errors: allInvalidRows.slice(0, 5),
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
