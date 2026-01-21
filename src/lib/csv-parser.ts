import Papa from 'papaparse';

export interface CSVParseResult {
  headers: string[];
  rows: Record<string, string>[];
  delimiter: string;
  errors: string[];
}

/**
 * Smart CSV parser that:
 * - Auto-detects delimiter (comma or semicolon)
 * - Handles quoted fields with embedded commas
 * - Properly handles Russian/Cyrillic characters
 * - Converts to consistent row format
 */
export function parseCSVContent(content: string): CSVParseResult {
  // Clean BOM if present
  const cleanContent = content.replace(/^\uFEFF/, '');
  
  // Try to detect delimiter from first line
  const firstLine = cleanContent.split('\n')[0] || '';
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semicolonCount = (firstLine.match(/;/g) || []).length;
  
  // If semicolon is more common outside quotes, use it
  const delimiter = semicolonCount > commaCount ? ';' : ',';
  
  const result = Papa.parse<Record<string, string>>(cleanContent, {
    header: true,
    delimiter: delimiter,
    skipEmptyLines: true,
    transformHeader: (header: string) => header.trim().replace(/^\"/, '').replace(/\"$/, ''),
    transform: (value: string) => value.trim(),
  });
  
  return {
    headers: result.meta.fields || [],
    rows: result.data,
    delimiter: result.meta.delimiter,
    errors: result.errors.map(e => `Row ${e.row}: ${e.message}`),
  };
}

/**
 * Normalize bePaid status to canonical values
 * MUST match DB constraint and RPC logic
 */
import { toCanonicalStatus, isRefundTransactionType, isCancelTransactionType, type CanonicalStatus } from './paymentStatus';

export type NormalizedStatus = CanonicalStatus;

/**
 * Normalize bePaid status to canonical values using centralized paymentStatus.ts
 * 
 * PRIORITY ORDER:
 * 1. Transaction type (refund/cancel) overrides status
 * 2. Message contains failure indicators
 * 3. Status text normalization via toCanonicalStatus
 * 4. UNKNOWN → returns null (NOT 'pending') for safety
 * 
 * @returns CanonicalStatus or null if unrecognized (caller decides how to handle)
 */
export function normalizeStatus(
  statusRaw: string | undefined,
  transactionType: string | undefined,
  message: string | undefined
): CanonicalStatus | null {
  const status = (statusRaw || '').toLowerCase().trim();
  const msg = (message || '').toLowerCase();
  
  // PRIORITY 1: Transaction type takes precedence
  // bePaid uses "Возврат средств" for refunds and "Отмена" for voids
  if (isRefundTransactionType(transactionType)) {
    return 'refunded';
  }
  if (isCancelTransactionType(transactionType)) {
    return 'canceled';
  }
  
  // PRIORITY 2: Check message for failure indicators
  const failureIndicators = [
    'declined', 'отклон', 'error', 'insufficient', 'reject', 
    'fail', 'ошибк', 'denied', 'refused'
  ];
  if (failureIndicators.some(ind => msg.includes(ind))) {
    return 'failed';
  }
  
  // PRIORITY 3: Use centralized status normalization
  const canonical = toCanonicalStatus(statusRaw);
  if (canonical) {
    return canonical;
  }
  
  // UNKNOWN: Return null instead of defaulting to 'pending'
  // This prevents writing garbage to DB - caller should handle null
  if (status) {
    console.warn(`[csv-parser] Unknown status: "${statusRaw}" (type: "${transactionType}")`);
  }
  return null;
}

/**
 * Parse amount from various formats (1,234.56 or 1234,56)
 */
export function parseAmount(value: string | number | undefined): number {
  if (value === undefined || value === null || value === '') return 0;
  
  const str = String(value);
  // Remove currency symbols and whitespace
  let cleaned = str.replace(/[^\d.,\-]/g, '');
  
  // Handle comma as decimal separator (European format)
  // If there's only one comma and it's followed by 1-2 digits, treat as decimal
  const commaMatch = cleaned.match(/,(\d{1,2})$/);
  if (commaMatch) {
    cleaned = cleaned.replace(',', '.');
  } else {
    // Otherwise remove commas (thousand separators)
    cleaned = cleaned.replace(/,/g, '');
  }
  
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/**
 * Parse date from various formats to ISO string
 */
export function parseDate(dateStr: string | undefined): string | undefined {
  if (!dateStr || dateStr.trim() === '') return undefined;
  
  // Format: DD.MM.YYYY HH:MM:SS
  let match = dateStr.match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):?(\d{2})?/);
  if (match) {
    const [, day, month, year, hour, min, sec = '00'] = match;
    return `${year}-${month}-${day}T${hour}:${min}:${sec}`;
  }
  
  // Format: YYYY-MM-DD HH:MM:SS +ZZZZ
  match = dateStr.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\s*([+-]\d{4})?/);
  if (match) {
    const [, year, month, day, hour, min, sec] = match;
    return `${year}-${month}-${day}T${hour}:${min}:${sec}`;
  }
  
  // Try native Date parsing as fallback
  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }
  
  return undefined;
}

/**
 * Detect payment method type from row
 */
export function detectPaymentMethod(row: Record<string, string>): 'card' | 'erip' {
  const method = (row['Способ оплаты'] || row['Payment method'] || '').toLowerCase();
  
  if (method === 'erip' || method.includes('ерип')) {
    return 'erip';
  }
  
  // Check for ERIP-specific columns
  if (row['Номер операции ЕРИП'] || row['Код услуги'] || row['Расчетный агент']) {
    return 'erip';
  }
  
  return 'card';
}

/**
 * Extract card last 4 digits from card mask
 */
export function extractCardLast4(cardMask: string | undefined): string | undefined {
  if (!cardMask) return undefined;
  const match = cardMask.match(/(\d{4})\s*$/);
  return match ? match[1] : undefined;
}

/**
 * Detect card brand from mask or payment method
 */
export function detectCardBrand(cardMask: string | undefined, paymentMethod: string | undefined): string {
  const method = (paymentMethod || '').toLowerCase();
  
  if (method.includes('visa')) return 'visa';
  if (method.includes('master')) return 'mastercard';
  if (method.includes('belkart')) return 'belkart';
  if (method.includes('halva')) return 'halva';
  if (method.includes('mir') || method.includes('мир')) return 'mir';
  
  // Detect from BIN
  if (cardMask) {
    const firstDigit = cardMask.charAt(0);
    if (firstDigit === '4') return 'visa';
    if (firstDigit === '5') return 'mastercard';
    if (cardMask.startsWith('911')) return 'belkart';
  }
  
  return method || 'unknown';
}
