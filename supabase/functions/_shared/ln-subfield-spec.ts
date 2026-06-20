// ============================================================================
// ln-subfield-spec.ts — PATCH-ROLE-SCOPED-PERSON-PLACEHOLDERS-V1
// ----------------------------------------------------------------------------
// Контракт scalar role-scoped person placeholders: {{ln-XXXXXX.<sub_field>}}.
//
//   • Голый {{ln-XXXXXX}} — НЕ трогаем (резолвится прежней веткой).
//   • Источник данных — legal_details_persons (полный row), назначения берём
//     из document_package_item_role_assignments (per-document SOT).
//   • Whitelist sub_field — этот файл.
//   • Pure helper: без I/O, без Deno globals, без supabase-клиента.
// ============================================================================

export type LnSubFieldKind = 'name' | 'date' | 'text' | 'address_full' | 'address_part';

export interface LnSubFieldSpec {
  /** Sub-field token (`{{ln-XXXXXX.<key>}}`). */
  key: string;
  /** Подпись для UI каталога. */
  label_ru: string;
  /** Семантика для рендера + валидации модификаторов. */
  kind: LnSubFieldKind;
  /** Колонка `legal_details_persons` (для kind=name/date/text/address_full=address_structured). */
  column?: string;
  /** Для kind=address_part — ключ внутри address_structured (jsonb). */
  jsonb_key?: string;
  /** Поддерживает |case=... ? (текстовые поля без падежей — false). */
  supports_case: boolean;
  /** Multi-person policy: 'join' (склейка через ;) или 'error' (multiple_persons_for_scalar_role_subfield). */
  multi_policy: 'join' | 'error';
}

// Канонический whitelist v1. Любое sub_field вне списка → ln_subfield_unknown.
export const LN_SUB_FIELD_SPECS: LnSubFieldSpec[] = [
  { key: 'full_name', label_ru: 'ФИО (полное)', kind: 'name', column: 'full_name', supports_case: true, multi_policy: 'join' },
  { key: 'short_name', label_ru: 'ФИО (краткое, Иванов И. И.)', kind: 'name', column: 'full_name', supports_case: true, multi_policy: 'join' },
  { key: 'signature_short', label_ru: 'ФИО для подписи (И. И. Иванов)', kind: 'name', column: 'full_name', supports_case: true, multi_policy: 'join' },
  { key: 'birth_date', label_ru: 'Дата рождения', kind: 'date', column: 'birth_date', supports_case: false, multi_policy: 'error' },
  { key: 'personal_number', label_ru: 'Личный номер', kind: 'text', column: 'personal_number', supports_case: false, multi_policy: 'error' },
  { key: 'passport_series', label_ru: 'Паспорт: серия', kind: 'text', column: 'passport_series', supports_case: false, multi_policy: 'error' },
  { key: 'passport_number', label_ru: 'Паспорт: номер', kind: 'text', column: 'passport_number', supports_case: false, multi_policy: 'error' },
  { key: 'passport_number_full', label_ru: 'Паспорт: серия и номер', kind: 'text', column: 'passport_number_full', supports_case: false, multi_policy: 'error' },
  { key: 'passport_issued_by', label_ru: 'Паспорт: кем выдан', kind: 'text', column: 'passport_issued_by', supports_case: false, multi_policy: 'error' },
  { key: 'passport_issued_date', label_ru: 'Паспорт: дата выдачи', kind: 'date', column: 'passport_issued_date', supports_case: false, multi_policy: 'error' },
  { key: 'passport_valid_until', label_ru: 'Паспорт: действителен до', kind: 'date', column: 'passport_valid_until', supports_case: false, multi_policy: 'error' },
  { key: 'phone', label_ru: 'Телефон', kind: 'text', column: 'phone', supports_case: false, multi_policy: 'error' },
  { key: 'email', label_ru: 'Email', kind: 'text', column: 'email', supports_case: false, multi_policy: 'error' },
  { key: 'address_full', label_ru: 'Адрес (полный)', kind: 'address_full', column: 'address_structured', supports_case: true, multi_policy: 'join' },
  { key: 'address_country', label_ru: 'Адрес: страна', kind: 'address_part', jsonb_key: 'country', supports_case: false, multi_policy: 'error' },
  { key: 'address_region', label_ru: 'Адрес: область/регион', kind: 'address_part', jsonb_key: 'region', supports_case: false, multi_policy: 'error' },
  { key: 'address_postal_code', label_ru: 'Адрес: индекс', kind: 'address_part', jsonb_key: 'postal_code', supports_case: false, multi_policy: 'error' },
  { key: 'address_city', label_ru: 'Адрес: город', kind: 'address_part', jsonb_key: 'city', supports_case: false, multi_policy: 'error' },
  { key: 'address_street', label_ru: 'Адрес: улица', kind: 'address_part', jsonb_key: 'street', supports_case: false, multi_policy: 'error' },
  { key: 'address_house', label_ru: 'Адрес: дом', kind: 'address_part', jsonb_key: 'house', supports_case: false, multi_policy: 'error' },
  { key: 'address_building', label_ru: 'Адрес: корпус', kind: 'address_part', jsonb_key: 'building', supports_case: false, multi_policy: 'error' },
  { key: 'address_apartment', label_ru: 'Адрес: квартира/офис', kind: 'address_part', jsonb_key: 'apartment', supports_case: false, multi_policy: 'error' },
  { key: 'bank_account', label_ru: 'Банк: счёт', kind: 'text', column: 'bank_account', supports_case: false, multi_policy: 'error' },
  { key: 'bank_name', label_ru: 'Банк: наименование', kind: 'text', column: 'bank_name', supports_case: false, multi_policy: 'error' },
  { key: 'bank_code', label_ru: 'Банк: код', kind: 'text', column: 'bank_code', supports_case: false, multi_policy: 'error' },
];

export const LN_SUB_FIELD_BY_KEY: ReadonlyMap<string, LnSubFieldSpec> = new Map(
  LN_SUB_FIELD_SPECS.map((s) => [s.key, s]),
);

/** Допустимые значения модификатора |format=... для kind=date. */
export const LN_SUB_DATE_FORMATS = new Set(['full', 'short', 'dotted']);

/** Допустимые значения |format=... для kind=name (зеркало PERSON_NAME_FORMATS). */
export const LN_SUB_NAME_FORMATS = new Set(['full', 'short', 'signature_short']);

/**
 * Свёртка raw row legal_details_persons → значение sub_field (без модификаторов).
 * Возвращает '' (пустую строку) если значение отсутствует.
 */
export function extractLnSubFieldRaw(person: Record<string, unknown>, spec: LnSubFieldSpec): string {
  if (spec.kind === 'address_part') {
    const addr = person['address_structured'];
    if (!addr || typeof addr !== 'object') return '';
    const v = (addr as Record<string, unknown>)[spec.jsonb_key!];
    return v == null ? '' : String(v).trim();
  }
  if (spec.kind === 'address_full') {
    const addr = person['address_structured'];
    if (!addr || typeof addr !== 'object') return '';
    return joinAddressFull(addr as Record<string, unknown>);
  }
  if (!spec.column) return '';
  const v = person[spec.column];
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  return String(v);
}

/**
 * Сборка строки полного адреса из address_structured.
 * Контракт совместим с проектным каноном (см. *_address_structured).
 */
export function joinAddressFull(addr: Record<string, unknown>): string {
  const parts: string[] = [];
  const get = (k: string): string => {
    const v = addr[k];
    return v == null ? '' : String(v).trim();
  };
  const country = get('country');
  const postal = get('postal_code');
  const region = get('region');
  const city = get('city');
  const street = get('street');
  const house = get('house');
  const building = get('building');
  const apartment = get('apartment');
  const head: string[] = [];
  if (postal) head.push(postal);
  if (country) head.push(country);
  if (region) head.push(region);
  if (city) head.push(city);
  if (head.length) parts.push(head.join(', '));
  const street_line: string[] = [];
  if (street) street_line.push(street);
  if (house) street_line.push(`д. ${house}`);
  if (building) street_line.push(`корп. ${building}`);
  if (apartment) street_line.push(`кв. ${apartment}`);
  if (street_line.length) parts.push(street_line.join(', '));
  return parts.join(', ');
}

/**
 * Формат даты для kind=date. Принимает ISO-строку или Date-like; пустое → ''.
 *   - 'dotted' (default) → dd.MM.yyyy
 *   - 'short'            → dd.MM.yyyy (alias to dotted)
 *   - 'full'             → «15 января 1990 г.»
 */
export function formatLnDate(raw: string, fmt: string | null | undefined): string {
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  if (fmt === 'full') {
    const months = [
      'января','февраля','марта','апреля','мая','июня',
      'июля','августа','сентября','октября','ноября','декабря',
    ];
    return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${yyyy} г.`;
  }
  // 'dotted' | 'short' | null (default)
  return `${dd}.${mm}.${yyyy}`;
}

/** Регэксп для распознавания sub-field токенов в шаблонах. */
export const LN_SUBFIELD_TOKEN_RE = /^(ln-\d{6})\.([a-z_]+)((?:\|[a-z_]+=[A-Za-z0-9_.]+)*)$/;
/** Sub-field токены в классификаторе (без префиксов A-Z и точек в значениях). */
export const LN_SUBFIELD_TOKEN_RE_CLASSIFIER = /^(ln-\d{6})\.([a-z_]+)((?:\|[a-z_]+=[a-z_]+)*)$/;
