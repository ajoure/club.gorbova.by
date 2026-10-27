/**
 * Diagnostic Table V2 — types, columns, computed logic, validation, prefill
 * 
 * V2 extends V1 with management analytics fields.
 * Computed fields are runtime-only (not persisted in state_json).
 * Client-only fields are visible/required only for rows where source_type === 'клиент'.
 */

// ──────────────────────────────────────────────
// V2 Row type (persisted fields only)
// ──────────────────────────────────────────────
export interface DiagnosticTableV2Row {
  _id: string;
  client: string;
  source_type: string;       // 'найм' | 'клиент'
  monthly_income: number;
  direct_hours: number;
  mental_hours: number;
  legal_risk: string;
  financial_risk: string;
  reputation_risk: string;
  emotional_load: number;
  comment: string;
  // Client-only fields (empty for non-client rows)
  business_type: string;
  client_factors: string;
  strategic_value: string;
  what_to_change: string;
  management_decision: string;
}

// ──────────────────────────────────────────────
// V2 Computed values (runtime-only, NOT persisted)
// ──────────────────────────────────────────────
export interface DiagnosticTableV2Computed {
  total_hours: number;
  hourly_income: number;
  efficiency: string;        // 'высокая' | 'низкая' | ''
  load_share: number;        // 0–1
  load_level: string;        // 'высокая' | 'низкая' | ''
  client_category: string;   // масштабируемый/рискованный/низкомаржинальный/токсичный | ''
}

// ──────────────────────────────────────────────
// Version guard utility
// ──────────────────────────────────────────────
export function isDiagnosticV2(content: unknown): boolean {
  return (content as any)?.version === 'v2';
}

// ──────────────────────────────────────────────
// V2 Column definitions (20 total)
// ──────────────────────────────────────────────
export interface V2ColumnDef {
  id: string;
  name: string;
  type: 'text' | 'number' | 'select' | 'computed' | 'slider';
  options?: string[];
  formula?: string;
  width?: number;
  required?: boolean;
  min?: number;
  max?: number;
  condition?: 'client_only';
}

export const DEFAULT_V2_COLUMNS: V2ColumnDef[] = [
  { id: 'client', name: 'Клиент / источник', type: 'text', required: true },
  { id: 'source_type', name: 'Тип', type: 'select', options: ['найм', 'клиент'], required: true },
  { id: 'monthly_income', name: 'Доход в месяц, BYN', type: 'number', required: true },
  { id: 'direct_hours', name: 'Часы прямой работы', type: 'number' },
  { id: 'mental_hours', name: 'Часы ментальной нагрузки', type: 'number' },
  { id: 'total_hours', name: 'Общие часы', type: 'computed' },
  { id: 'hourly_income', name: 'Доход за час, BYN', type: 'computed' },
  { id: 'legal_risk', name: 'Юридические риски', type: 'select', options: ['низкий', 'средний', 'высокий'] },
  { id: 'financial_risk', name: 'Финансовые риски', type: 'select', options: ['низкий', 'средний', 'высокий'] },
  { id: 'reputation_risk', name: 'Репутационные риски', type: 'select', options: ['низкий', 'средний', 'высокий'] },
  { id: 'emotional_load', name: 'Эмоциональная нагрузка (1-10)', type: 'slider', min: 1, max: 10 },
  { id: 'comment', name: 'Комментарий', type: 'text' },
  // Client-only fields
  { id: 'business_type', name: 'Тип бизнеса', type: 'select', options: ['ИП', 'ООО', 'самозанятый', 'физлицо', 'другое'], condition: 'client_only' },
  { id: 'efficiency', name: 'Экономическая эффективность', type: 'computed', condition: 'client_only' },
  { id: 'load_share', name: 'Доля нагрузки', type: 'computed', condition: 'client_only' },
  { id: 'load_level', name: 'Уровень нагрузки', type: 'computed', condition: 'client_only' },
  { id: 'client_category', name: 'Категория клиента', type: 'computed', condition: 'client_only' },
  { id: 'client_factors', name: 'Факторы клиента', type: 'text', condition: 'client_only' },
  { id: 'strategic_value', name: 'Стратегическая ценность клиента', type: 'text', condition: 'client_only' },
  { id: 'what_to_change', name: 'Что нужно изменить', type: 'text', condition: 'client_only' },
  { id: 'management_decision', name: 'Управленческое решение', type: 'text', condition: 'client_only' },
];

// Set of client-only column IDs for quick checks
export const V2_CLIENT_ONLY_IDS = new Set(
  DEFAULT_V2_COLUMNS.filter(c => c.condition === 'client_only').map(c => c.id)
);

// ──────────────────────────────────────────────
// Helper: check if a row is completely empty (skip in validation)
// ──────────────────────────────────────────────
export function isRowEmpty(row: Record<string, unknown>): boolean {
  const client = String(row.client || '').trim();
  const sourceType = String(row.source_type || '').trim();
  const income = Number(row.monthly_income) || 0;
  return !client && !sourceType && income === 0;
}

// ──────────────────────────────────────────────
// V2 Computed field calculation (safe, no eval)
// ──────────────────────────────────────────────
export function calculateV2Computed(
  row: Record<string, unknown>,
  allRows: Record<string, unknown>[]
): DiagnosticTableV2Computed {
  const monthlyIncome = Math.max(0, Number(row.monthly_income) || 0);
  const directHours = Math.max(0, Number(row.direct_hours) || 0);
  const mentalHours = Math.max(0, Number(row.mental_hours) || 0);
  const totalHours = directHours + mentalHours;
  const hourlyIncome = totalHours > 0
    ? Math.round((monthlyIncome / totalHours) * 100) / 100
    : 0;

  const isClient = String(row.source_type) === 'клиент';

  // Cross-row computations (only for non-empty rows)
  const validRows = allRows.filter(r => !isRowEmpty(r));
  const allTotalHours = validRows.reduce((sum, r) => {
    return sum + Math.max(0, Number(r.direct_hours) || 0) + Math.max(0, Number(r.mental_hours) || 0);
  }, 0);

  const allTotalIncome = validRows.reduce(
    (sum, r) => sum + Math.max(0, Number(r.monthly_income) || 0), 0
  );
  const avgHourlyIncome = allTotalHours > 0 ? allTotalIncome / allTotalHours : 0;

  const loadShare = allTotalHours > 0
    ? Math.round((totalHours / allTotalHours) * 100) / 100
    : 0;

  // For non-client rows: return empty client-specific computed values
  if (!isClient) {
    return {
      total_hours: totalHours,
      hourly_income: hourlyIncome,
      efficiency: '',
      load_share: 0,
      load_level: '',
      client_category: '',
    };
  }

  const efficiency = hourlyIncome >= avgHourlyIncome ? 'высокая' : 'низкая';
  const loadLevel = loadShare > 0.2 ? 'высокая' : 'низкая';

  // Category matrix
  let clientCategory = '';
  if (efficiency === 'высокая' && loadLevel === 'низкая') clientCategory = 'масштабируемый';
  else if (efficiency === 'высокая' && loadLevel === 'высокая') clientCategory = 'рискованный';
  else if (efficiency === 'низкая' && loadLevel === 'низкая') clientCategory = 'низкомаржинальный';
  else if (efficiency === 'низкая' && loadLevel === 'высокая') clientCategory = 'токсичный';

  return {
    total_hours: totalHours,
    hourly_income: hourlyIncome,
    efficiency,
    load_share: loadShare,
    load_level: loadLevel,
    client_category: clientCategory,
  };
}

// Format V2 computed value for display
export function formatV2Computed(
  value: number | string,
  colId: string
): string {
  if (colId === 'load_share') {
    const num = value as number;
    if (!Number.isFinite(num) || num === 0) return '—';
    return `${Math.round(num * 100)}%`;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '—';
    if (value === 0 && (colId === 'efficiency' || colId === 'load_level' || colId === 'client_category')) return '—';
    return String(Math.round(value * 100) / 100);
  }
  return String(value || '—');
}

// ──────────────────────────────────────────────
// V2 Aggregates
// ──────────────────────────────────────────────
export interface V2Aggregates {
  total_income: number;
  total_hours: number;
  avg_hourly_income: number;
  category_counts: Record<string, number>;
}

export function calculateV2Aggregates(
  rows: Record<string, unknown>[]
): V2Aggregates | null {
  const validRows = rows.filter(r => !isRowEmpty(r));
  if (validRows.length === 0) return null;

  const totalIncome = validRows.reduce(
    (sum, r) => sum + Math.max(0, Number(r.monthly_income) || 0), 0
  );
  const totalHours = validRows.reduce((sum, r) => {
    return sum + Math.max(0, Number(r.direct_hours) || 0) + Math.max(0, Number(r.mental_hours) || 0);
  }, 0);
  const avgHourlyIncome = totalHours > 0
    ? Math.round((totalIncome / totalHours) * 100) / 100
    : 0;

  // Count client categories
  const categoryCounts: Record<string, number> = {};
  validRows.forEach(row => {
    if (String(row.source_type) === 'клиент') {
      const computed = calculateV2Computed(row, validRows);
      const cat = computed.client_category;
      if (cat) categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    }
  });

  return {
    total_income: totalIncome,
    total_hours: totalHours,
    avg_hourly_income: avgHourlyIncome,
    category_counts: categoryCounts,
  };
}

// ──────────────────────────────────────────────
// V2 Validation
// ──────────────────────────────────────────────
export interface V2ValidationError {
  rowIndex: number;
  field: string;
  message: string;
}

export function validateV2Rows(
  rows: Record<string, unknown>[]
): V2ValidationError[] {
  const errors: V2ValidationError[] = [];

  rows.forEach((row, idx) => {
    // Skip completely empty rows
    if (isRowEmpty(row)) return;

    const sourceType = String(row.source_type || '');
    const client = String(row.client || '').trim();
    const monthlyIncome = Number(row.monthly_income) || 0;

    // All rows: required fields
    if (!client) {
      errors.push({
        rowIndex: idx,
        field: 'client',
        message: `Строка ${idx + 1}: укажите клиента / источник`,
      });
    }
    if (!sourceType) {
      // Guard: check if client-only fields have data without source_type
      const hasClientData = !!(
        row.business_type || row.client_factors ||
        row.what_to_change || row.management_decision
      );
      errors.push({
        rowIndex: idx,
        field: 'source_type',
        message: hasClientData
          ? `Строка ${idx + 1}: выберите тип (найм/клиент) — заполнены клиентские поля`
          : `Строка ${idx + 1}: выберите тип (найм/клиент)`,
      });
    }
    if (monthlyIncome <= 0) {
      errors.push({
        rowIndex: idx,
        field: 'monthly_income',
        message: `Строка ${idx + 1}: укажите доход > 0`,
      });
    }

    // Client rows: required analytical fields
    if (sourceType === 'клиент') {
      if (!String(row.business_type || '').trim()) {
        errors.push({
          rowIndex: idx,
          field: 'business_type',
          message: `Строка ${idx + 1}: укажите тип бизнеса`,
        });
      }
      if (!String(row.what_to_change || '').trim()) {
        errors.push({
          rowIndex: idx,
          field: 'what_to_change',
          message: `Строка ${idx + 1}: укажите что нужно изменить`,
        });
      }
      if (!String(row.management_decision || '').trim()) {
        errors.push({
          rowIndex: idx,
          field: 'management_decision',
          message: `Строка ${idx + 1}: укажите управленческое решение`,
        });
      }
      // client_factors — NOT required per spec
    }
  });

  return errors;
}

// ──────────────────────────────────────────────
// Runtime prefill: V1 → V2 (one-time migration)
// ──────────────────────────────────────────────

/** Normalize V1 plural risk values to V2 singular form */
function mapRiskValue(v1: string): string {
  const map: Record<string, string> = {
    'низкие': 'низкий',
    'средние': 'средний',
    'высокие': 'высокий',
  };
  const trimmed = v1.trim().toLowerCase();
  return map[trimmed] || v1;
}

export function prefillV2FromV1(
  v1Rows: Record<string, unknown>[]
): DiagnosticTableV2Row[] {
  return v1Rows.map(row => ({
    _id: Math.random().toString(36).substring(2, 9),
    client: String(row.source || ''),
    source_type: String(row.income_type || row.type || ''),
    monthly_income: Number(row.income || row.monthly_income) || 0,
    direct_hours: Number(row.direct_hours || row.work_hours) || 0,
    mental_hours: Number(row.mental_hours || row.overhead_hours) || 0,
    // hourly_rate is NOT copied — computed as hourly_income at runtime
    legal_risk: mapRiskValue(String(row.legal_risk || '')),
    financial_risk: mapRiskValue(String(row.financial_risk || '')),
    reputation_risk: mapRiskValue(String(row.reputation_risk || '')),
    emotional_load: Number(row.emotional_load) || 5,
    comment: String(row.comment || ''),
    // V2 new fields — empty, user fills manually
    business_type: '',
    client_factors: '',
    strategic_value: '',
    what_to_change: '',
    management_decision: '',
  }));
}

// ──────────────────────────────────────────────
// V2 Default content for admin editor / SQL seed
// ──────────────────────────────────────────────
export const DEFAULT_V2_CONTENT = {
  version: 'v2' as const,
  title: 'Аналитика портфеля клиентов',
  instruction: 'Дозаполните таблицу аналитическими данными по каждому клиенту',
  columns: DEFAULT_V2_COLUMNS,
  minRows: 1,
  showAggregates: true,
  submitButtonText: 'Аналитика завершена',
  layout: 'vertical' as const,
  source_lesson_id: '' as string, // Must be set to V1 diagnostic lesson ID
};

// IDs of text fields that should render as textarea (multi-line)
export const V2_TEXTAREA_FIELD_IDS = new Set([
  'client_factors',
  'strategic_value',
  'what_to_change',
  'management_decision',
]);

// Category display helpers
export const CATEGORY_COLORS: Record<string, string> = {
  'масштабируемый': 'bg-green-500/10 text-green-700',
  'рискованный': 'bg-amber-500/10 text-amber-700',
  'низкомаржинальный': 'bg-blue-500/10 text-blue-700',
  'токсичный': 'bg-red-500/10 text-red-700',
};
