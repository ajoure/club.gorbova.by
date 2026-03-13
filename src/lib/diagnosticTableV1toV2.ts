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
  what_to_change: string;
  management_decision: string;
}

// ──────────────────────────────────────────────
// V2 Computed values (runtime-only, NOT persisted)
// ──────────────────────────────────────────────
export interface DiagnosticTableV2Computed {
  total_hours: number;
  hourly_income: number;
  efficiency: string;        // 'высокая' | 'низкая'
  load_share: number;        // 0–1
  load_level: string;        // 'высокая' | 'низкая'
  client_category: string;   // масштабируемый/рискованный/низкомаржинальный/токсичный
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
  { id: 'monthly_income', name: 'Доход в месяц', type: 'number', required: true },
  { id: 'direct_hours', name: 'Часы прямой работы', type: 'number' },
  { id: 'mental_hours', name: 'Часы ментальной нагрузки', type: 'number' },
  { id: 'total_hours', name: 'Общие часы', type: 'computed' },
  { id: 'hourly_income', name: 'Доход за час', type: 'computed' },
  { id: 'legal_risk', name: 'Юр. риски', type: 'select', options: ['низкий', 'средний', 'высокий'] },
  { id: 'financial_risk', name: 'Фин. риски', type: 'select', options: ['низкий', 'средний', 'высокий'] },
  { id: 'reputation_risk', name: 'Реп. риски', type: 'select', options: ['низкий', 'средний', 'высокий'] },
  { id: 'emotional_load', name: 'Эмоц. нагрузка (1-10)', type: 'slider', min: 1, max: 10 },
  { id: 'comment', name: 'Комментарий', type: 'text' },
  // Client-only fields
  { id: 'business_type', name: 'Тип бизнеса', type: 'select', options: ['ИП', 'ООО', 'самозанятый', 'физлицо', 'другое'], condition: 'client_only' },
  { id: 'efficiency', name: 'Экон. эффективность', type: 'computed', condition: 'client_only' },
  { id: 'load_share', name: 'Доля нагрузки', type: 'computed', condition: 'client_only' },
  { id: 'load_level', name: 'Уровень нагрузки', type: 'computed', condition: 'client_only' },
  { id: 'client_category', name: 'Категория клиента', type: 'computed', condition: 'client_only' },
  { id: 'client_factors', name: 'Факторы клиента', type: 'text', condition: 'client_only' },
  { id: 'what_to_change', name: 'Что нужно изменить', type: 'text', condition: 'client_only' },
  { id: 'management_decision', name: 'Управленческое решение', type: 'text', condition: 'client_only' },
];

// Set of client-only column IDs for quick checks
export const V2_CLIENT_ONLY_IDS = new Set(
  DEFAULT_V2_COLUMNS.filter(c => c.condition === 'client_only').map(c => c.id)
);

// ──────────────────────────────────────────────
// V2 Computed field calculation (safe, no eval)
// ──────────────────────────────────────────────
export function calculateV2Computed(
  row: Record<string, unknown>,
  allRows: Record<string, unknown>[]
): DiagnosticTableV2Computed {
  const monthlyIncome = Number(row.monthly_income) || 0;
  const directHours = Number(row.direct_hours) || 0;
  const mentalHours = Number(row.mental_hours) || 0;
  const totalHours = directHours + mentalHours;
  const hourlyIncome = totalHours > 0
    ? Math.round((monthlyIncome / totalHours) * 100) / 100
    : 0;

  // Cross-row computations
  const allTotalHours = allRows.reduce((sum, r) => {
    return sum + (Number(r.direct_hours) || 0) + (Number(r.mental_hours) || 0);
  }, 0);

  const allTotalIncome = allRows.reduce(
    (sum, r) => sum + (Number(r.monthly_income) || 0), 0
  );
  const avgHourlyIncome = allTotalHours > 0 ? allTotalIncome / allTotalHours : 0;

  const loadShare = allTotalHours > 0
    ? Math.round((totalHours / allTotalHours) * 100) / 100
    : 0;

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
  if (colId === 'load_share') return `${Math.round((value as number) * 100)}%`;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '—';
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
  if (rows.length === 0) return null;

  const totalIncome = rows.reduce(
    (sum, r) => sum + (Number(r.monthly_income) || 0), 0
  );
  const totalHours = rows.reduce((sum, r) => {
    return sum + (Number(r.direct_hours) || 0) + (Number(r.mental_hours) || 0);
  }, 0);
  const avgHourlyIncome = totalHours > 0
    ? Math.round((totalIncome / totalHours) * 100) / 100
    : 0;

  // Count client categories
  const categoryCounts: Record<string, number> = {};
  rows.forEach(row => {
    if (String(row.source_type) === 'клиент') {
      const computed = calculateV2Computed(row, rows);
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
export function prefillV2FromV1(
  v1Rows: Record<string, unknown>[]
): Record<string, unknown>[] {
  return v1Rows.map(row => ({
    _id: Math.random().toString(36).substring(2, 9),
    client: row.source || '',
    source_type: row.type || '',
    monthly_income: Number(row.income) || 0,
    direct_hours: Number(row.work_hours) || 0,
    mental_hours: Number(row.overhead_hours) || 0,
    // hourly_rate is NOT copied — computed as hourly_income at runtime
    legal_risk: row.legal_risk || '',
    financial_risk: row.financial_risk || '',
    reputation_risk: row.reputation_risk || '',
    emotional_load: row.emotional_load ?? 5,
    comment: row.comment || '',
    // V2 new fields — empty, user fills manually
    business_type: '',
    client_factors: '',
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
};

// Category display helpers
export const CATEGORY_COLORS: Record<string, string> = {
  'масштабируемый': 'bg-green-500/10 text-green-700',
  'рискованный': 'bg-amber-500/10 text-amber-700',
  'низкомаржинальный': 'bg-blue-500/10 text-blue-700',
  'токсичный': 'bg-red-500/10 text-red-700',
};
